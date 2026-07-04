package main

import (
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// provider onboard — bootstrapper funds a join node and registers it as validator.
func providerMain(args []string) {
	if len(args) == 0 {
		fmt.Println(`titan provider - onboard validators

  titan provider onboard --from @treasury.key --uri http://JOIN_NODE:9650
      Fund (C→P) and register a join node as permissionless validator.
      Optional: --amount, --duration-days, --delegation-fee (percent).
      Run from the bootstrap node after the join node is synced.

  titan provider list [--uri http://127.0.0.1:9650]
      List active validators.`)
		return
	}

	switch args[0] {
	case "onboard":
		providerOnboardMain(args[1:])
	case "list":
		statusMain(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown provider subcommand: %s\n", args[0])
		os.Exit(1)
	}
}

func providerOnboardMain(args []string) {
	fs := flag.NewFlagSet("provider onboard", flag.ExitOnError)
	from := fs.String("from", "", "treasury key @file on bootstrap node")
	amount := fs.Float64("amount", defaultValidatorStakeTitan, "tokens to stake for the provider")
	days := fs.Int("duration-days", 14, "validator duration")
	delegationFee := fs.Float64("delegation-fee", defaultDelegationFeePercent, "validator share of delegator rewards (percent)")
	startOffset := fs.Duration("start-offset", 5*time.Minute, "delay before validator start time")
	satellite := fs.Bool("satellite", false, "register as FTSO satellite oracle provider")
	uri := fs.String("uri", "", "join node API (required)")
	nodeID := fs.String("node-id", "", "optional NodeID if auto-detect fails")
	pub := fs.String("bls-pub", "", "optional BLS public key")
	pop := fs.String("bls-pop", "", "optional BLS proof of possession")
	fs.Parse(args)

	if *from == "" {
		fmt.Fprintln(os.Stderr, "--from is required (treasury key on bootstrap node)")
		os.Exit(1)
	}
	if *uri == "" {
		fmt.Fprintln(os.Stderr, "--uri is required (join node's http://IP:9650)")
		os.Exit(1)
	}

	fmt.Println("=== Provider onboarding (fund + register validator) ===")
	validatorMain(buildProviderValidatorArgs(providerOnboardParams{
		from:          *from,
		amount:        *amount,
		days:          *days,
		delegationFee: *delegationFee,
		startOffset:   *startOffset,
		satellite:     *satellite,
		uri:           *uri,
		nodeID:        *nodeID,
		blsPub:        *pub,
		blsPop:        *pop,
	}))
}

type providerOnboardParams struct {
	from          string
	amount        float64
	days          int
	delegationFee float64
	startOffset   time.Duration
	satellite     bool
	uri           string
	nodeID        string
	blsPub        string
	blsPop        string
}

func buildProviderValidatorArgs(p providerOnboardParams) []string {
	args := []string{
		"add",
		"--from", p.from,
		"--uri", "http://127.0.0.1:9650",
		"--target-uri", strings.TrimRight(p.uri, "/"),
		"--amount", strconv.FormatFloat(p.amount, 'f', -1, 64),
		"--duration-days", strconv.Itoa(p.days),
		"--delegation-fee", strconv.FormatFloat(p.delegationFee, 'f', -1, 64),
		"--start-offset", p.startOffset.String(),
	}
	if p.satellite {
		args = append(args, "--satellite")
	}
	if p.nodeID != "" {
		args = append(args, "--node-id", p.nodeID)
	}
	if p.blsPub != "" {
		args = append(args, "--bls-pub", p.blsPub)
	}
	if p.blsPop != "" {
		args = append(args, "--bls-pop", p.blsPop)
	}
	return args
}
