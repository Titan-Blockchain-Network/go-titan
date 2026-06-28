// Feature: deployment — local Docker compose + helper script contract.
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDockerLocalComposeBindsLocalhost(t *testing.T) {
	t.Parallel()
	root, err := findRepoRootForTests()
	if err != nil {
		t.Skip(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "docker", "docker-compose.local.yml"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, "127.0.0.1:9650:9650") {
		t.Fatal("local compose should bind API to localhost only")
	}
	if !strings.Contains(text, "AUTOCONFIGURE_PUBLIC_IP: \"0\"") {
		t.Fatal("local compose should disable public IP autoconfigure")
	}
	if !strings.Contains(text, "network-health-min-conn-peers=0") {
		t.Fatal("local compose should relax peer health for solo dev nodes")
	}
}

func TestDockerLocalScriptExists(t *testing.T) {
	t.Parallel()
	root, err := findRepoRootForTests()
	if err != nil {
		t.Skip(err)
	}
	path := filepath.Join(root, "docker", "docker-local.sh")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&0111 == 0 {
		t.Fatal("docker-local.sh should be executable")
	}
}

func findRepoRootForTests() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for dir := wd; dir != "/" && dir != "."; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, "docker", "docker-compose.local.yml")); err == nil {
			if _, err := os.Stat(filepath.Join(dir, "avalanchego")); err == nil {
				return dir, nil
			}
		}
	}
	return "", os.ErrNotExist
}