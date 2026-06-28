package main

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"math/big"
	"math/rand"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/ava-labs/avalanchego/genesis"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/crypto/secp256k1"
	"github.com/ava-labs/avalanchego/utils/formatting/address"
	"github.com/ava-labs/avalanchego/utils/units"
)

const (
	defaultOriginPath    = "titan-network/origin.json"
	defaultExampleOrigin = "titan-network/origin.example.json"
	weiPerToken          = 1_000_000_000_000_000_000
	minCustomNetworkID   = 100_000
	maxCustomNetworkID   = 999_999_999
)

type originMetadata struct {
	BlockchainName string `json:"blockchainName,omitempty"`
	TokenTicker    string `json:"tokenTicker,omitempty"`
}

type originAllocation struct {
	AVAXAddr       string               `json:"avaxAddr"`
	EthAddr        string               `json:"ethAddr"`
	InitialAmount  uint64               `json:"initialAmount"`
	UnlockSchedule []originLockedAmount `json:"unlockSchedule"`
}

type originLockedAmount struct {
	Amount   uint64 `json:"amount"`
	Locktime uint64 `json:"locktime,omitempty"`
}

type originStaker struct {
	DelegationFee uint32           `json:"delegationFee"`
	NodeID        string           `json:"nodeID"`
	RewardAddress string           `json:"rewardAddress"`
	Signer        *originBLSSigner `json:"signer,omitempty"`
}

type originBLSSigner struct {
	PublicKey         string `json:"publicKey"`
	ProofOfPossession string `json:"proofOfPossession"`
}

type originConfig struct {
	originMetadata
	NetworkID                  uint32             `json:"networkID"`
	Allocations                []originAllocation `json:"allocations"`
	StartTime                  uint64             `json:"startTime"`
	InitialStakeDuration       uint64             `json:"initialStakeDuration"`
	InitialStakeDurationOffset uint64             `json:"initialStakeDurationOffset"`
	InitialStakedFunds         []string           `json:"initialStakedFunds"`
	InitialStakers             []originStaker     `json:"initialStakers"`
	CChainGenesis              string             `json:"cChainGenesis"`
	Message                    string             `json:"message"`
}

type cChainGenesisDoc struct {
	Config     cChainConfig             `json:"config"`
	Nonce      string                   `json:"nonce"`
	Timestamp  string                   `json:"timestamp"`
	ExtraData  string                   `json:"extraData"`
	GasLimit   string                   `json:"gasLimit"`
	Difficulty string                   `json:"difficulty"`
	MixHash    string                   `json:"mixHash"`
	Coinbase   string                   `json:"coinbase"`
	Alloc      map[string]cChainAccount `json:"alloc"`
	Number     string                   `json:"number"`
	GasUsed    string                   `json:"gasUsed"`
	ParentHash string                   `json:"parentHash"`
}

type cChainConfig struct {
	ChainID                     uint64 `json:"chainId"`
	HomesteadBlock              uint64 `json:"homesteadBlock"`
	DaoForkBlock                uint64 `json:"daoForkBlock"`
	DaoForkSupport              bool   `json:"daoForkSupport"`
	Eip150Block                 uint64 `json:"eip150Block"`
	Eip150Hash                  string `json:"eip150Hash"`
	Eip155Block                 uint64 `json:"eip155Block"`
	Eip158Block                 uint64 `json:"eip158Block"`
	ByzantiumBlock              uint64 `json:"byzantiumBlock"`
	ConstantinopleBlock         uint64 `json:"constantinopleBlock"`
	PetersburgBlock             uint64 `json:"petersburgBlock"`
	IstanbulBlock               uint64 `json:"istanbulBlock"`
	MuirGlacierBlock            uint64 `json:"muirGlacierBlock"`
	ApricotPhase1BlockTimestamp uint64 `json:"apricotPhase1BlockTimestamp"`
	ApricotPhase2BlockTimestamp uint64 `json:"apricotPhase2BlockTimestamp"`
}

type cChainAccount struct {
	Balance string `json:"balance"`
	Code    string `json:"code,omitempty"`
}

type promptReader struct {
	reader *bufio.Reader
}

func (p *promptReader) ask(label, defaultVal string) string {
	if defaultVal != "" {
		fmt.Printf("%s [%s]: ", label, defaultVal)
	} else {
		fmt.Printf("%s: ", label)
	}
	line, _ := p.reader.ReadString('\n')
	line = strings.TrimSpace(line)
	if line == "" {
		return defaultVal
	}
	return line
}

func (p *promptReader) askYesNo(label string, defaultYes bool) bool {
	def := "y/N"
	if defaultYes {
		def = "Y/n"
	}
	for {
		ans := strings.ToLower(p.ask(label+" ("+def+")", ""))
		if ans == "" {
			return defaultYes
		}
		switch ans {
		case "y", "yes":
			return true
		case "n", "no":
			return false
		default:
			fmt.Println("  Please answer y or n.")
		}
	}
}

func suggestChainID() uint32 {
	return uint32(minCustomNetworkID + rand.Intn(maxCustomNetworkID-minCustomNetworkID))
}

// validateCustomChainID checks the Avalanche network ID and C-chain EVM chainId.
func validateCustomChainID(raw string) (uint32, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, fmt.Errorf("chain ID is required")
	}
	parsed, err := strconv.ParseUint(raw, 10, 32)
	if err != nil {
		return 0, fmt.Errorf("%q is not a valid whole number", raw)
	}
	if parsed < minCustomNetworkID {
		return 0, fmt.Errorf(
			"%d is too low — custom L1 networks must use %d or higher (Avalanche reserves lower IDs for mainnet and public testnets)",
			parsed, minCustomNetworkID,
		)
	}
	if parsed > maxCustomNetworkID {
		return 0, fmt.Errorf("%d is too high — maximum allowed chain ID is %d", parsed, maxCustomNetworkID)
	}
	return uint32(parsed), nil
}

func chainIDRequirementHelp() string {
	return fmt.Sprintf(
		"  Chain ID is the Avalanche network ID and C-chain EVM chainId.\n"+
			"  Valid range: %d–%d (IDs below %d are reserved).",
		minCustomNetworkID, maxCustomNetworkID, minCustomNetworkID,
	)
}

func (p *promptReader) askChainID(defaultSuggested string) (uint32, error) {
	fmt.Println(chainIDRequirementHelp())
	for {
		chainIDStr := p.ask("Chain ID (network + C-chain)", defaultSuggested)
		id, err := validateCustomChainID(chainIDStr)
		if err == nil {
			return id, nil
		}
		fmt.Printf("  ✗ %v\n", err)
		fmt.Println("  Please enter a different chain ID.")
	}
}

func validateEthAddress(addr string) error {
	addr = strings.TrimSpace(addr)
	if !strings.HasPrefix(addr, "0x") || len(addr) != 42 {
		return fmt.Errorf("invalid Ethereum address %q (expected 0x + 40 hex chars)", addr)
	}
	if _, err := hex.DecodeString(addr[2:]); err != nil {
		return fmt.Errorf("invalid hex in address %q: %w", addr, err)
	}
	return nil
}

func validateTokenAmount(tokens string) (uint64, error) {
	tokens = strings.TrimSpace(tokens)
	if tokens == "" {
		return 0, fmt.Errorf("amount is required")
	}
	parts := strings.SplitN(tokens, ".", 2)
	whole, err := strconv.ParseUint(parts[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid token amount %q", tokens)
	}
	frac := uint64(0)
	if len(parts) == 2 {
		fracStr := parts[1]
		if len(fracStr) > 18 {
			return 0, fmt.Errorf("too many decimal places (max 18)")
		}
		fracStr = fracStr + strings.Repeat("0", 18-len(fracStr))
		frac, err = strconv.ParseUint(fracStr, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid fractional amount")
		}
	}
	// nAVAX units: 1 token = 1e9 nAVAX in Avalanche denomination
	nAvax := whole*units.Avax + frac*(units.Avax/weiPerToken)
	return nAvax, nil
}

func tokensToWeiHex(tokens string) (string, error) {
	tokens = strings.TrimSpace(tokens)
	if tokens == "" {
		return "0x0", nil
	}
	rat, ok := new(big.Rat).SetString(tokens)
	if !ok {
		return "", fmt.Errorf("invalid token amount %q", tokens)
	}
	wei := new(big.Int).Mul(rat.Num(), big.NewInt(weiPerToken))
	wei.Div(wei, rat.Denom())
	return "0x" + wei.Text(16), nil
}

func deriveChainAddressesFromKey(priv *secp256k1.PrivateKey, networkID uint32) (chainAddresses, error) {
	hrp := constants.GetHRP(networkID)
	if hrp == "" {
		hrp = "titan"
	}
	shortID := priv.Address()
	p, err := address.Format("P", hrp, shortID.Bytes())
	if err != nil {
		return chainAddresses{}, err
	}
	x, err := address.Format("X", hrp, shortID.Bytes())
	if err != nil {
		return chainAddresses{}, err
	}
	return chainAddresses{
		C: priv.PublicKey().EthAddress().Hex(),
		P: p,
		X: x,
	}, nil
}

func defaultCChainGenesis(chainID uint32, alloc map[string]cChainAccount) (string, error) {
	doc := cChainGenesisDoc{
		Config: cChainConfig{
			ChainID:                     uint64(chainID),
			HomesteadBlock:              0,
			DaoForkBlock:                0,
			DaoForkSupport:              true,
			Eip150Block:                 0,
			Eip150Hash:                  "0x2086799aeebeae135c246c65021c82b4e15a2c451340993aacfd2751886514f0",
			Eip155Block:                 0,
			Eip158Block:                 0,
			ByzantiumBlock:              0,
			ConstantinopleBlock:         0,
			PetersburgBlock:             0,
			IstanbulBlock:               0,
			MuirGlacierBlock:            0,
			ApricotPhase1BlockTimestamp: 0,
			ApricotPhase2BlockTimestamp: 0,
		},
		Nonce:      "0x0",
		Timestamp:  "0x0",
		ExtraData:  "0x00",
		GasLimit:   "0x5f5e100",
		Difficulty: "0x0",
		MixHash:    "0x0000000000000000000000000000000000000000000000000000000000000000",
		Coinbase:   genesis.FlareSystemCoinbaseAddress,
		Alloc:      alloc,
		Number:     "0x0",
		GasUsed:    "0x0",
		ParentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func resolveGenesisJSONPath() (string, error) {
	if path, err := findGenesisJSONPath(); err == nil {
		return path, nil
	}
	root, err := findRepoRoot()
	if err != nil {
		return "", err
	}
	path := filepath.Join(root, "avalanchego", "genesis", "genesis_titan.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	return path, nil
}

func findRepoRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for dir := wd; dir != "/" && dir != "."; dir = filepath.Dir(dir) {
		hasAvago := false
		if _, err := os.Stat(filepath.Join(dir, "avalanchego")); err == nil {
			hasAvago = true
		}
		if _, err := os.Stat(filepath.Join(dir, "titan-network")); err == nil {
			return dir, nil
		}
		if _, err := os.Stat(filepath.Join(dir, "titan-network", "origin.example.json")); err == nil {
			return dir, nil
		}
		if hasAvago {
			return dir, nil
		}
	}
	return "", fmt.Errorf("could not find repo root (looked for titan-network/ or avalanchego/)")
}

func resolveOriginPath(explicit string) (string, error) {
	if explicit != "" {
		if !filepath.IsAbs(explicit) {
			root, err := findRepoRoot()
			if err == nil {
				return filepath.Join(root, explicit), nil
			}
		}
		return explicit, nil
	}
	root, err := findRepoRoot()
	if err != nil {
		return defaultOriginPath, nil
	}
	return filepath.Join(root, defaultOriginPath), nil
}

func runGenesisCreate(args []string) error {
	return runGenesisCreateFromReader(args, bufio.NewReader(os.Stdin))
}

func runGenesisCreateFromReader(args []string, reader *bufio.Reader) error {
	fs := flag.NewFlagSet("genesis create", flag.ExitOnError)
	out := fs.String("output", "", "output path (default: titan-network/origin.json)")
	nonInteractive := fs.Bool("non-interactive", false, "use defaults for testing")
	fs.Parse(args)

	outPath, err := resolveOriginPath(*out)
	if err != nil {
		return err
	}

	rand.Seed(time.Now().UnixNano())
	p := &promptReader{reader: reader}

	fmt.Println("Genesis configuration")
	fmt.Println("Output: titan-network/origin.json")
	fmt.Println()

	blockchainName := "MyChain"
	tokenTicker := "MYTKN"
	var chainID uint32
	var totalSupplyTokens string
	var allocations []originAllocation
	var stakers []originStaker
	var stakedFunds []string

	if *nonInteractive {
		blockchainName = "TestChain"
		tokenTicker = "TEST"
		chainID = 424242
		allocations = []originAllocation{{
			EthAddr:       "0x0123456789abcdef0123456789abcdef01234567",
			AVAXAddr:      "X-titan1qy352euf40x77qfrg4ncn27dauqjx3t8r0zhyn",
			InitialAmount: 0,
			UnlockSchedule: []originLockedAmount{{
				Amount: 1000 * units.Avax,
			}},
		}}
	} else {
		blockchainName = p.ask("Blockchain name", blockchainName)
		tokenTicker = strings.ToUpper(p.ask("Token ticker", tokenTicker))
		suggested := strconv.FormatUint(uint64(suggestChainID()), 10)
		var err error
		chainID, err = p.askChainID(suggested)
		if err != nil {
			return err
		}

		totalSupplyTokens = p.ask("Total supply (tokens)", "1000000000")
		fmt.Println()
		fmt.Println("Initial allocations (blank line to finish).")
		fmt.Println("  Private key (0x...) derives C/P/X addresses automatically.")

		var runningTotal uint64
		for i := 1; ; i++ {
			keyOrAddr := p.ask(fmt.Sprintf("Allocation %d — private key (0x...) or C-chain address", i), "")
			if keyOrAddr == "" {
				break
			}
			var eth, xAddr string
			if strings.HasPrefix(keyOrAddr, "@") || (len(keyOrAddr) == 64 && !strings.HasPrefix(keyOrAddr, "0x")) || len(keyOrAddr) == 66 {
				priv, err := loadKey(keyOrAddr)
				if err != nil {
					fmt.Printf("  ✗ %v\n", err)
					i--
					continue
				}
				addrs, err := deriveChainAddressesFromKey(priv, chainID)
				if err != nil {
					fmt.Printf("  ✗ %v\n", err)
					i--
					continue
				}
				eth, xAddr = addrs.C, addrs.X
				fmt.Printf("  Derived C: %s  X: %s  P: %s\n", addrs.C, addrs.X, addrs.P)
			} else {
				eth = keyOrAddr
				if err := validateEthAddress(eth); err != nil {
					fmt.Printf("  ✗ %v\n", err)
					i--
					continue
				}
				xAddr = p.ask("  X-chain address (X-...)", "")
				if xAddr == "" {
					fmt.Println("  ✗ X-chain address required when no private key provided")
					i--
					continue
				}
			}
			amountStr := p.ask("  Amount (tokens)", "")
			nAvax, err := validateTokenAmount(amountStr)
			if err != nil {
				fmt.Printf("  ✗ %v\n", err)
				i--
				continue
			}
			allocations = append(allocations, originAllocation{
				EthAddr:       eth,
				AVAXAddr:      xAddr,
				InitialAmount: 0,
				UnlockSchedule: []originLockedAmount{{
					Amount: nAvax,
				}},
			})
			runningTotal += nAvax
			fmt.Printf("  ✓ Added %s tokens to %s (X: %s)\n", amountStr, eth, xAddr)
		}

		if len(allocations) == 0 {
			return fmt.Errorf("at least one allocation is required")
		}

		totalNAvax, err := validateTokenAmount(totalSupplyTokens)
		if err != nil {
			return err
		}
		if runningTotal > totalNAvax {
			return fmt.Errorf("allocations total exceeds declared supply")
		}
		if runningTotal < totalNAvax {
			fmt.Printf("  Note: allocated %.4f of %.4f total supply tokens\n",
				float64(runningTotal)/float64(units.Avax),
				float64(totalNAvax)/float64(units.Avax))
		}

		if p.askYesNo("Add initial genesis validator(s)?", true) {
			fmt.Println("  Generate staking keys with: titan keys generate --genesis --dir <path>")
			var genesisStakedTotal uint64
			for i := 1; ; i++ {
				nodeID := p.ask(fmt.Sprintf("Staker %d — NodeID (blank to finish)", i), "")
				if nodeID == "" {
					break
				}
				reward := p.ask("  P-chain reward address", "")
				pub := p.ask("  BLS public key (0x...)", "")
				pop := p.ask("  BLS proof of possession (0x...)", "")
				stakeAmt := p.ask("  Stake amount (tokens)", "2000")
				nAvax, err := validateTokenAmount(stakeAmt)
				if err != nil {
					return err
				}
				if err := validateValidatorStake(float64(nAvax) / float64(units.Avax)); err != nil {
					return err
				}
				if len(allocations) == 0 {
					return fmt.Errorf("at least one allocation is required before adding genesis validators")
				}
				fundAddr := allocations[0].AVAXAddr
				if genesisStakedTotal+nAvax > allocations[0].UnlockSchedule[0].Amount {
					return fmt.Errorf("genesis validator stake exceeds allocation on %s", fundAddr)
				}
				if reward == "" {
					reward = strings.Replace(fundAddr, "X-", "P-", 1)
				}
				stakers = append(stakers, originStaker{
					NodeID:        nodeID,
					RewardAddress: reward,
					DelegationFee: 0,
					Signer: &originBLSSigner{
						PublicKey:         pub,
						ProofOfPossession: pop,
					},
				})
				stakedFunds = append(stakedFunds, fundAddr)
				genesisStakedTotal += nAvax
			}
		}
	}

	cAlloc := make(map[string]cChainAccount)
	for _, a := range allocations {
		tokens := float64(a.UnlockSchedule[0].Amount) / float64(units.Avax)
		wei, err := tokensToWeiHex(fmt.Sprintf("%.9f", tokens))
		if err != nil {
			return err
		}
		cAlloc[strings.ToLower(a.EthAddr)] = cChainAccount{Balance: wei}
	}

	cChain, err := defaultCChainGenesis(chainID, cAlloc)
	if err != nil {
		return err
	}
	cChain, err = injectStakingContracts(cChain)
	if err != nil {
		return fmt.Errorf("inject staking contracts: %w", err)
	}

	startTime := uint64(time.Now().UTC().Add(-2 * time.Hour).Unix())
	cfg := originConfig{
		originMetadata: originMetadata{
			BlockchainName: blockchainName,
			TokenTicker:    tokenTicker,
		},
		NetworkID:                  chainID,
		Allocations:                allocations,
		StartTime:                  startTime,
		InitialStakeDuration:       31536000,
		InitialStakeDurationOffset: 5400,
		InitialStakedFunds:         stakedFunds,
		InitialStakers:             stakers,
		CChainGenesis:              cChain,
		Message:                    strings.ToLower(blockchainName),
	}

	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		return err
	}
	outBytes, err := json.MarshalIndent(cfg, "", "    ")
	if err != nil {
		return err
	}
	outBytes = append(outBytes, '\n')
	if err := os.WriteFile(outPath, outBytes, 0o644); err != nil {
		return err
	}

	fmt.Println()
	fmt.Printf("✓ Genesis saved to %s\n", outPath)
	fmt.Println()
	fmt.Println("Next:")
	fmt.Println("  titan genesis apply")
	fmt.Println("  ./scripts/build-titan.sh")
	fmt.Println("  titan node bootstrap --first")
	return nil
}

func runGenesisApply(args []string) error {
	fs := flag.NewFlagSet("genesis apply", flag.ExitOnError)
	from := fs.String("from", "", "origin.json path (default: titan-network/origin.json)")
	fs.Parse(args)

	originPath, err := resolveOriginPath(*from)
	if err != nil {
		return err
	}
	if _, err := os.Stat(originPath); err != nil {
		examplePath, _ := resolveOriginPath(defaultExampleOrigin)
		if _, exErr := os.Stat(examplePath); exErr == nil {
			return fmt.Errorf("%s not found; run: titan genesis create", originPath)
		}
		return fmt.Errorf("read %s: %w", originPath, err)
	}

	genesisPath, err := resolveGenesisJSONPath()
	if err != nil {
		return err
	}

	data, err := os.ReadFile(originPath)
	if err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("parse origin: %w", err)
	}
	var meta originMetadata
	_ = json.Unmarshal(data, &meta)

	var cfg originConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return fmt.Errorf("parse origin config: %w", err)
	}

	blockchainName := meta.BlockchainName
	if blockchainName == "" {
		blockchainName = cfg.Message
	}
	if blockchainName == "" {
		blockchainName = "titan"
	}

	if err := configureNetworkFromGenesis(cfg.NetworkID, blockchainName); err != nil {
		return fmt.Errorf("create network config: %w", err)
	}

	if cfg.CChainGenesis != "" {
		updated, err := injectStakingContracts(cfg.CChainGenesis)
		if err != nil {
			return fmt.Errorf("inject staking contracts: %w", err)
		}
		cfg.CChainGenesis = updated
		raw["cChainGenesis"], err = json.Marshal(cfg.CChainGenesis)
		if err != nil {
			return err
		}
	}

	delete(raw, "blockchainName")
	delete(raw, "tokenTicker")

	out, err := json.MarshalIndent(raw, "", "    ")
	if err != nil {
		return err
	}
	out = append(out, '\n')
	tmp := genesisPath + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, genesisPath); err != nil {
		return err
	}

	fmt.Printf("✓ Applied %s → %s\n", originPath, genesisPath)
	fmt.Println("  Rebuild: cd avalanchego && ./scripts/build-titan.sh")
	return nil
}
