// Copyright (C) 2019-2025, Ava Labs, Inc. All rights reserved.
// See the file LICENSE for licensing terms.

package c

import (
	"context"

	"github.com/ava-labs/avalanchego/api/info"
	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/snow"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/logging"
	"github.com/ava-labs/avalanchego/vms/platformvm"
)

const Alias = "C"

type Context struct {
	NetworkID    uint32
	BlockchainID ids.ID
	AVAXAssetID  ids.ID
}

func NewContextFromURI(ctx context.Context, uri string) (*Context, error) {
	infoClient := info.NewClient(uri)
	pChainClient := platformvm.NewClient(uri)
	return NewContextFromClients(ctx, infoClient, pChainClient)
}

func NewContextFromClients(
	ctx context.Context,
	infoClient *info.Client,
	pChainClient *platformvm.Client,
) (*Context, error) {
	networkID, err := infoClient.GetNetworkID(ctx)
	if err != nil {
		return nil, err
	}

	blockchainID, err := infoClient.GetBlockchainID(ctx, Alias)
	if err != nil {
		return nil, err
	}

	// Match the asset ID the C-chain VM uses when verifying atomic exports (same
	// source as platform.getStakingAssetID). The X-chain "AVAX" alias can differ
	// on custom networks like Titan.
	avaxAssetID, err := pChainClient.GetStakingAssetID(ctx, constants.PrimaryNetworkID)
	if err != nil {
		return nil, err
	}

	return &Context{
		NetworkID:    networkID,
		BlockchainID: blockchainID,
		AVAXAssetID:  avaxAssetID,
	}, nil
}

func newSnowContext(c *Context) (*snow.Context, error) {
	lookup := ids.NewAliaser()
	return &snow.Context{
		NetworkID:   c.NetworkID,
		SubnetID:    constants.PrimaryNetworkID,
		ChainID:     c.BlockchainID,
		CChainID:    c.BlockchainID,
		AVAXAssetID: c.AVAXAssetID,
		Log:         logging.NoLog{},
		BCLookup:    lookup,
	}, lookup.Alias(c.BlockchainID, Alias)
}
