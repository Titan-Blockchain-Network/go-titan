package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

const networkIDsRelPath = "utils/constants/network_ids.go"

var (
	reTitanID   = regexp.MustCompile(`TitanID\s+uint32\s*=\s*\d+`)
	reTitanName = regexp.MustCompile(`TitanName\s+=\s*"[^"]*"`)
	reTitanHRP  = regexp.MustCompile(`TitanHRP\s+=\s*"[^"]*"`)
)

func slugNetworkName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "" {
		return "titan"
	}
	var b strings.Builder
	prevDash := false
	for _, r := range name {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			prevDash = false
		case r == ' ' || r == '-' || r == '_':
			if b.Len() > 0 && !prevDash {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "titan"
	}
	if len(out) > 32 {
		out = out[:32]
	}
	return out
}

func sanitizeHRP(name string) string {
	hrp := slugNetworkName(name)
	hrp = strings.ReplaceAll(hrp, "-", "")
	if hrp == "" {
		return "titan"
	}
	// bech32 HRP practical limit for custom chains
	if len(hrp) > 16 {
		hrp = hrp[:16]
	}
	return hrp
}

func findNetworkIDsPath() (string, error) {
	avagoDir, err := findAvalanchegoDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(avagoDir, networkIDsRelPath), nil
}

// configureNetworkFromGenesis registers the custom L1 in network_ids.go from origin.json.
// This is the "network creation" step — no manual code edits before build/deploy.
func configureNetworkFromGenesis(networkID uint32, blockchainName string) error {
	networkName := slugNetworkName(blockchainName)
	hrp := sanitizeHRP(blockchainName)

	path, err := findNetworkIDsPath()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}

	updated := string(data)
	updated = reTitanID.ReplaceAllString(updated, fmt.Sprintf("TitanID      uint32 = %d", networkID))
	updated = reTitanName.ReplaceAllString(updated, fmt.Sprintf(`TitanName      = "%s"`, networkName))
	updated = reTitanHRP.ReplaceAllString(updated, fmt.Sprintf(`TitanHRP      = "%s"`, hrp))

	if updated == string(data) {
		fmt.Printf("  Network already configured in %s (ID=%d name=%s hrp=%s)\n", path, networkID, networkName, hrp)
		return nil
	}

	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(updated), 0644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}

	fmt.Printf("  Network created in %s (ID=%d name=%s hrp=%s)\n", path, networkID, networkName, hrp)
	return nil
}

func readNetworkIDsTitanValues() (id uint32, name, hrp string, err error) {
	path, err := findNetworkIDsPath()
	if err != nil {
		return 0, "", "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, "", "", err
	}
	content := string(data)

	idLine := reTitanID.FindString(content)
	if idLine == "" {
		return 0, "", "", fmt.Errorf("TitanID not found")
	}
	parts := strings.Split(idLine, "=")
	if len(parts) != 2 {
		return 0, "", "", fmt.Errorf("parse TitanID")
	}
	parsed, err := strconv.ParseUint(strings.TrimSpace(parts[1]), 10, 32)
	if err != nil {
		return 0, "", "", fmt.Errorf("parse TitanID: %w", err)
	}

	nameLine := reTitanName.FindString(content)
	hrpLine := reTitanHRP.FindString(content)
	if nameLine == "" || hrpLine == "" {
		return 0, "", "", fmt.Errorf("TitanName/TitanHRP not found")
	}
	name = strings.Trim(strings.Split(nameLine, "=")[1], `" `)
	hrp = strings.Trim(strings.Split(hrpLine, "=")[1], `" `)
	return uint32(parsed), name, hrp, nil
}