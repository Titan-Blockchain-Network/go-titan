package main

import (
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// provider onboard — bootstrapper funds a join node and registers it as validator.
func providerMain(args []string) {
	if len(args) == 0 {
		fmt.Println(`titan provider - onboard validators to your L1

  titan provider onboard --from @treasury.key --uri http://JOIN_NODE:9650
      Fund (C→P) and register a join node as permissionless validator.
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
	validatorArgs := []string{
		"add",
		"--from", *from,
		"--uri", "http://127.0.0.1:9650",
		"--target-uri", strings.TrimRight(*uri, "/"),
		"--amount", strconv.FormatFloat(*amount, 'f', -1, 64),
		"--duration-days", strconv.Itoa(*days),
	}
	if *nodeID != "" {
		validatorArgs = append(validatorArgs, "--node-id", *nodeID)
	}
	if *pub != "" {
		validatorArgs = append(validatorArgs, "--bls-pub", *pub)
	}
	if *pop != "" {
		validatorArgs = append(validatorArgs, "--bls-pop", *pop)
	}
	validatorMain(validatorArgs)
}