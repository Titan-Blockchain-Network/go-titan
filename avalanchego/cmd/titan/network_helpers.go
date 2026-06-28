package main

import (
	"github.com/ava-labs/avalanchego/genesis"
	"github.com/ava-labs/avalanchego/utils/constants"
)

// deployedNetworkID returns the network ID from on-disk or embedded genesis.
func deployedNetworkID() (uint32, error) {
	if cfg, err := loadDiskGenesisConfig(); err == nil {
		return cfg.NetworkID, nil
	}
	return genesis.GetConfig(constants.TitanID).NetworkID, nil
}

func deployedNetworkName() string {
	id, err := deployedNetworkID()
	if err != nil {
		return constants.TitanName
	}
	return constants.NetworkName(id)
}
