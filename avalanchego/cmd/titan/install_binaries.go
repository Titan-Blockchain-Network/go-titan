package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	defaultBinDir          = "/usr/local/bin"
	avalanchegoInstallName = "avalanchego"
	titanInstallName       = "titan"
)

// installBuiltBinaries copies build/avalanchego and build/titan into defaultBinDir.
// Any listed systemd units are stopped before copy and restarted afterward when restart is true.
func installBuiltBinaries(restart bool, services ...string) error {
	avagoDir, err := findAvalanchegoDir()
	if err != nil {
		return err
	}

	agPath := filepath.Join(avagoDir, "build", avalanchegoInstallName)
	titanPath := filepath.Join(avagoDir, "build", titanInstallName)
	if _, err := os.Stat(agPath); err != nil {
		return fmt.Errorf("missing %s — run ./scripts/build-titan.sh first", agPath)
	}
	if _, err := os.Stat(titanPath); err != nil {
		return fmt.Errorf("missing %s — run ./scripts/build-titan.sh first", titanPath)
	}

	stopped := make([]string, 0, len(services))
	for _, svc := range services {
		if svc == "" {
			continue
		}
		_ = runPrivileged("systemctl", "stop", svc)
		stopped = append(stopped, svc)
	}
	if len(stopped) > 0 {
		time.Sleep(2 * time.Second)
	}

	if err := installOneBinary(agPath, filepath.Join(defaultBinDir, avalanchegoInstallName)); err != nil {
		return fmt.Errorf("install avalanchego: %w", err)
	}
	fmt.Printf("  Installed %s → %s/%s\n", agPath, defaultBinDir, avalanchegoInstallName)

	if err := installOneBinary(titanPath, filepath.Join(defaultBinDir, titanInstallName)); err != nil {
		return fmt.Errorf("install titan: %w", err)
	}
	fmt.Printf("  Installed %s → %s/%s\n", titanPath, defaultBinDir, titanInstallName)

	if restart {
		for _, svc := range stopped {
			if err := runPrivileged("systemctl", "start", svc); err != nil {
				fmt.Printf("  Warning: could not restart %s: %v\n", svc, err)
			}
		}
	}
	return nil
}

func installOneBinary(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".new"
	if err := copyFile(src, tmp); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o755); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		// Fallback for environments where rename over an existing file fails.
		if err2 := runPrivileged("cp", "-f", src, dst); err2 != nil {
			return fmt.Errorf("rename: %w; cp: %w", err, err2)
		}
		_ = runPrivileged("chmod", "+x", dst)
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, in, 0o755)
}
