package core

import (
	"math/big"
	"testing"

	agenesis "github.com/ava-labs/avalanchego/genesis"
	"github.com/ava-labs/avalanchego/upgrade"
	"github.com/ava-labs/coreth/consensus/dummy"
	"github.com/ava-labs/coreth/params"
	"github.com/ava-labs/coreth/plugin/evm/upgrade/ap3"
	"github.com/ava-labs/libevm/common"
	"github.com/ava-labs/libevm/core/rawdb"
	"github.com/ava-labs/libevm/core/types"
	"github.com/ava-labs/libevm/core/vm"
	"github.com/ava-labs/libevm/crypto"
)

func titanTestChainConfig() *params.ChainConfig {
	cfg := *params.TestFlareChainConfig
	cfg.ChainID = new(big.Int).Set(params.TitanChainID)
	return &cfg
}

func TestTitanFeeDistributionIncreasesPoolBalance(t *testing.T) {
	var (
		engine = dummy.NewCoinbaseFaker()

		key1, _ = crypto.HexToECDSA("b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291")
		addr1   = crypto.PubkeyToAddress(key1.PublicKey)
		addr2   = common.HexToAddress("0x00000000000000000000000000000000000000bb")
		funds   = new(big.Int).Mul(common.Big1, big.NewInt(params.Ether))

		poolAddr = common.HexToAddress(agenesis.DefaultTitanNetworkEconomicsConfig().FeeDistribution.RewardPoolAddress)
		burnAddr = common.HexToAddress(agenesis.FlareFeeSinkAddress)
		coinbase = common.HexToAddress(agenesis.FlareSystemCoinbaseAddress)

		gspec = &Genesis{
			Config:    titanTestChainConfig(),
			Timestamp: uint64(upgrade.InitiallyActiveTime.Unix()),
			Coinbase:  coinbase,
			BaseFee:   big.NewInt(ap3.InitialBaseFee),
			Alloc: types.GenesisAlloc{
				addr1:    {Balance: funds},
				poolAddr: {Balance: common.Big0},
				burnAddr: {Balance: common.Big0},
			},
		}
	)

	signer := types.LatestSigner(gspec.Config)
	_, blocks, _, _ := GenerateChainWithGenesis(gspec, engine, 1, 10, func(_ int, b *BlockGen) {
		b.SetCoinbase(coinbase)
		tx := types.NewTx(&types.DynamicFeeTx{
			ChainID:   gspec.Config.ChainID,
			Nonce:     0,
			To:        &addr2,
			Gas:       21_000,
			GasFeeCap: newGwei(225),
			GasTipCap: big.NewInt(2),
		})
		tx, _ = types.SignTx(tx, signer, key1)
		b.AddTx(tx)
	})

	chain, err := NewBlockChain(rawdb.NewMemoryDatabase(), DefaultCacheConfig, gspec, engine, vm.Config{}, common.Hash{}, false)
	if err != nil {
		t.Fatalf("create chain: %v", err)
	}
	defer chain.Stop()
	if n, err := chain.InsertChain(blocks); err != nil {
		t.Fatalf("insert block %d: %v", n, err)
	}

	block := chain.GetBlockByNumber(1)
	state, _ := chain.State()
	tx := block.Transactions()[0]

	gasPrice := new(big.Int).Add(block.BaseFee(), tx.EffectiveGasTipValue(block.BaseFee()))
	totalFee := new(big.Int).SetUint64(block.GasUsed() * gasPrice.Uint64())
	baseComponent := new(big.Int).SetUint64(block.GasUsed() * block.BaseFee().Uint64())
	wantPool := new(big.Int).Div(new(big.Int).Mul(baseComponent, big.NewInt(50)), big.NewInt(100))
	wantBurn := new(big.Int).Sub(totalFee, wantPool)

	poolBal := state.GetBalance(poolAddr).ToBig()
	if poolBal.Cmp(wantPool) != 0 {
		t.Fatalf("pool balance = %s, want %s", poolBal, wantPool)
	}
	burnBal := state.GetBalance(burnAddr).ToBig()
	if burnBal.Cmp(wantBurn) != 0 {
		t.Fatalf("burn balance = %s, want %s", burnBal, wantBurn)
	}
}
