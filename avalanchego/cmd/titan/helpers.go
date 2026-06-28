package main

import (
	"fmt"
	"os"
	"os/exec"
)

func isRoot() bool {
	return os.Geteuid() == 0
}

func runPrivileged(name string, args ...string) error {
	var cmd *exec.Cmd
	if isRoot() {
		cmd = exec.Command(name, args...)
	} else {
		cmd = exec.Command("sudo", append([]string{name}, args...)...)
	}
	out, err := cmd.CombinedOutput()
	if len(out) > 0 {
		fmt.Printf("%s", out)
	}
	return err
}

func bootstrapValues(first bool, joinIP, bootstrapID string) (string, string) {
	if first {
		return "", ""
	}
	return joinIP, bootstrapID
}
