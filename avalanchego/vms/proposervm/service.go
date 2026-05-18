// Copyright (C) 2019-2025, Ava Labs, Inc. All rights reserved.
// See the file LICENSE for licensing terms.

package proposervm

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"go.uber.org/zap"

	"github.com/ava-labs/avalanchego/api"
	"github.com/ava-labs/avalanchego/api/server"
	"github.com/ava-labs/avalanchego/connectproto/pb/proposervm/proposervmconnect"
	"github.com/ava-labs/avalanchego/database"
	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/vms/proposervm/acp181"
	"github.com/ava-labs/avalanchego/vms/proposervm/block"

	pb "github.com/ava-labs/avalanchego/connectproto/pb/proposervm"
	avajson "github.com/ava-labs/avalanchego/utils/json"
)

var _ proposervmconnect.ProposerVMHandler = (*connectrpcService)(nil)

type connectrpcService struct {
	vm *VM
}

func (c *connectrpcService) GetProposedHeight(ctx context.Context, r *connect.Request[pb.GetProposedHeightRequest]) (*connect.Response[pb.GetProposedHeightReply], error) {
	log := c.vm.ctx.Log.With(
		zap.String("service", "proposervm"),
		zap.String("method", "GetProposedHeight"),
		zap.Strings("route", r.Header()[server.HTTPHeaderRoute]),
	)
	log.Debug("API called")

	c.vm.ctx.Lock.Lock()
	defer c.vm.ctx.Lock.Unlock()

	blk, err := c.vm.getBlock(ctx, c.vm.preferred)
	if err != nil {
		log.Error("failed to get preferred block", zap.Error(err))
		return nil, fmt.Errorf("failed to get preferred block: %w", err)
	}

	height, err := blk.selectChildPChainHeight(ctx)
	if err != nil {
		log.Error("failed to get child p-chain height", zap.Error(err))
		return nil, fmt.Errorf("failed to get child p-chain height: %w", err)
	}

	return connect.NewResponse(&pb.GetProposedHeightReply{
		Height: height,
	}), nil
}

func (c *connectrpcService) GetCurrentEpoch(ctx context.Context, r *connect.Request[pb.GetCurrentEpochRequest]) (*connect.Response[pb.GetCurrentEpochReply], error) {
	c.vm.ctx.Log.Debug("API called",
		zap.String("service", "proposervm"),
		zap.String("method", "getCurrentEpoch"),
		zap.Strings("route", r.Header()[server.HTTPHeaderRoute]),
	)

	epoch, err := c.vm.getCurrentEpoch(ctx)
	if err != nil {
		return nil, fmt.Errorf("couldn't get current epoch: %w", err)
	}

	return connect.NewResponse(&pb.GetCurrentEpochReply{
		Number:       epoch.Number,
		StartTime:    epoch.StartTime,
		PChainHeight: epoch.PChainHeight,
	}), nil
}

type jsonrpcService struct {
	vm *VM
}

func (j *jsonrpcService) GetProposedHeight(r *http.Request, _ *struct{}, reply *api.GetHeightResponse) error {
	log := j.vm.ctx.Log.With(
		zap.String("service", "proposervm"),
		zap.String("method", "GetProposedHeight"),
		zap.String("path", r.URL.Path),
	)
	log.Debug("API called")

	j.vm.ctx.Lock.Lock()
	defer j.vm.ctx.Lock.Unlock()

	ctx := r.Context()
	blk, err := j.vm.getBlock(ctx, j.vm.preferred)
	if err != nil {
		log.Error("failed to get preferred block", zap.Error(err))
		return fmt.Errorf("failed to get preferred block: %w", err)
	}

	height, err := blk.selectChildPChainHeight(ctx)
	if err != nil {
		log.Error("failed to get child p-chain height", zap.Error(err))
		return fmt.Errorf("failed to get child p-chain height: %w", err)
	}

	reply.Height = avajson.Uint64(height)
	return nil
}

type GetEpochResponse struct {
	Number       avajson.Uint64 `json:"number"`
	StartTime    avajson.Uint64 `json:"startTime"`
	PChainHeight avajson.Uint64 `json:"pChainHeight"`
}

func (j *jsonrpcService) GetCurrentEpoch(r *http.Request, _ *struct{}, reply *GetEpochResponse) error {
	j.vm.ctx.Log.Debug("API called",
		zap.String("service", "proposervm"),
		zap.String("method", "getCurrentEpoch"),
	)

	epoch, err := j.vm.getCurrentEpoch(r.Context())
	if err != nil {
		return fmt.Errorf("couldn't get current epoch: %w", err)
	}

	reply.Number = avajson.Uint64(epoch.Number)
	reply.StartTime = avajson.Uint64(epoch.StartTime)
	reply.PChainHeight = avajson.Uint64(epoch.PChainHeight)
	return nil
}

// ProposerStatus describes whether a proposer could be resolved for a given
// EVM block hash, and if not, why not.
type ProposerStatus string

const (
	ProposerStatusOK           ProposerStatus = "ok"
	ProposerStatusPreFork      ProposerStatus = "preFork"
	ProposerStatusPruned       ProposerStatus = "pruned"
	ProposerStatusNotCanonical ProposerStatus = "notCanonical"
	ProposerStatusNotFound     ProposerStatus = "notFound"
)

type GetProposerByEVMBlockHashArgs struct {
	BlockHash string `json:"blockHash"`
}

type GetProposerByEVMBlockHashResponse struct {
	NodeID            ids.NodeID     `json:"nodeID"`
	Status            ProposerStatus `json:"status"`
	Height            avajson.Uint64 `json:"height"`
	PChainHeight      avajson.Uint64 `json:"pChainHeight"`
	Timestamp         avajson.Uint64 `json:"timestamp"`
	ProposerVMBlockID ids.ID         `json:"proposerVMBlockID"`
}

func (j *jsonrpcService) GetProposerByEVMBlockHash(r *http.Request, args *GetProposerByEVMBlockHashArgs, reply *GetProposerByEVMBlockHashResponse) error {
	log := j.vm.ctx.Log.With(
		zap.String("service", "proposervm"),
		zap.String("method", "GetProposerByEVMBlockHash"),
		zap.String("blockHash", args.BlockHash),
	)
	log.Debug("API called")

	hashStr := strings.TrimPrefix(args.BlockHash, "0x")
	hashStr = strings.TrimPrefix(hashStr, "0X")
	hashBytes, err := hex.DecodeString(hashStr)
	if err != nil {
		return fmt.Errorf("invalid block hash %q: %w", args.BlockHash, err)
	}
	innerID, err := ids.ToID(hashBytes)
	if err != nil {
		return fmt.Errorf("invalid block hash %q: %w", args.BlockHash, err)
	}

	j.vm.ctx.Lock.Lock()
	defer j.vm.ctx.Lock.Unlock()

	resp, err := j.vm.getProposerByInnerBlockID(r.Context(), innerID)
	if err != nil {
		return err
	}
	*reply = resp
	return nil
}

// getProposerByInnerBlockID resolves the proposer of the inner (EVM) block
// whose ID equals innerID. It returns a populated response with Status
// describing the outcome; only unexpected database errors return a non-nil
// error.
func (vm *VM) getProposerByInnerBlockID(ctx context.Context, innerID ids.ID) (GetProposerByEVMBlockHashResponse, error) {
	innerBlk, err := vm.ChainVM.GetBlock(ctx, innerID)
	if errors.Is(err, database.ErrNotFound) {
		return GetProposerByEVMBlockHashResponse{Status: ProposerStatusNotFound}, nil
	}
	if err != nil {
		return GetProposerByEVMBlockHashResponse{}, fmt.Errorf("failed to fetch inner block: %w", err)
	}
	height := innerBlk.Height()

	canonicalID, err := vm.ChainVM.GetBlockIDAtHeight(ctx, height)
	if errors.Is(err, database.ErrNotFound) {
		return GetProposerByEVMBlockHashResponse{
			Status: ProposerStatusNotCanonical,
			Height: avajson.Uint64(height),
		}, nil
	}
	if err != nil {
		return GetProposerByEVMBlockHashResponse{}, fmt.Errorf("failed to fetch canonical block at height %d: %w", height, err)
	}
	if canonicalID != innerID {
		return GetProposerByEVMBlockHashResponse{
			Status: ProposerStatusNotCanonical,
			Height: avajson.Uint64(height),
		}, nil
	}

	forkHeight, err := vm.State.GetForkHeight()
	switch {
	case errors.Is(err, database.ErrNotFound):
		return GetProposerByEVMBlockHashResponse{
			Status: ProposerStatusPreFork,
			Height: avajson.Uint64(height),
		}, nil
	case err != nil:
		return GetProposerByEVMBlockHashResponse{}, fmt.Errorf("failed to fetch fork height: %w", err)
	case height < forkHeight:
		return GetProposerByEVMBlockHashResponse{
			Status: ProposerStatusPreFork,
			Height: avajson.Uint64(height),
		}, nil
	}

	outerID, err := vm.State.GetBlockIDAtHeight(height)
	if errors.Is(err, database.ErrNotFound) {
		return GetProposerByEVMBlockHashResponse{
			Status: ProposerStatusPruned,
			Height: avajson.Uint64(height),
		}, nil
	}
	if err != nil {
		return GetProposerByEVMBlockHashResponse{}, fmt.Errorf("failed to fetch proposerVM block ID at height %d: %w", height, err)
	}

	outerBlock, err := vm.State.GetBlock(outerID)
	if errors.Is(err, database.ErrNotFound) {
		return GetProposerByEVMBlockHashResponse{
			Status:            ProposerStatusPruned,
			Height:            avajson.Uint64(height),
			ProposerVMBlockID: outerID,
		}, nil
	}
	if err != nil {
		return GetProposerByEVMBlockHashResponse{}, fmt.Errorf("failed to fetch proposerVM block %s: %w", outerID, err)
	}

	signedBlock, ok := outerBlock.(block.SignedBlock)
	if !ok {
		return GetProposerByEVMBlockHashResponse{
			Status:            ProposerStatusPreFork,
			Height:            avajson.Uint64(height),
			ProposerVMBlockID: outerID,
		}, nil
	}

	return GetProposerByEVMBlockHashResponse{
		NodeID:            signedBlock.Proposer(),
		Status:            ProposerStatusOK,
		Height:            avajson.Uint64(height),
		PChainHeight:      avajson.Uint64(signedBlock.PChainHeight()),
		Timestamp:         avajson.Uint64(signedBlock.Timestamp().Unix()),
		ProposerVMBlockID: outerID,
	}, nil
}

func (vm *VM) getCurrentEpoch(ctx context.Context) (block.Epoch, error) {
	vm.ctx.Lock.Lock()
	defer vm.ctx.Lock.Unlock()

	blk, err := vm.getBlock(ctx, vm.preferred)
	if err != nil {
		return block.Epoch{}, fmt.Errorf("couldn't get preferred block: %w", err)
	}

	epoch, err := blk.pChainEpoch(ctx)
	if err != nil {
		return block.Epoch{}, fmt.Errorf("couldn't get preferred block epoch: %w", err)
	}

	pChainHeight, err := blk.pChainHeight(ctx)
	if err != nil {
		return block.Epoch{}, fmt.Errorf("couldn't get preferred block p-chain height: %w", err)
	}

	timestamp := blk.Timestamp()
	newTimestamp := vm.Time().Truncate(time.Second)
	if newTimestamp.Before(timestamp) {
		newTimestamp = timestamp
	}

	return acp181.NewEpoch(
		vm.Upgrades,
		pChainHeight,
		epoch,
		timestamp,
		newTimestamp,
	), nil
}
