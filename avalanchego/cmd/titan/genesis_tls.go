package main

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
)

type originServeConfig struct {
	dataDir  string
	port     string
	tlsCert  string
	tlsKey   string
}

func (c originServeConfig) validate() error {
	if c.tlsCert == "" && c.tlsKey == "" {
		return nil
	}
	if c.tlsCert == "" || c.tlsKey == "" {
		return fmt.Errorf("both --tls-cert and --tls-key are required for TLS")
	}
	if _, err := os.Stat(c.tlsCert); err != nil {
		return fmt.Errorf("tls cert %s: %w", c.tlsCert, err)
	}
	if _, err := os.Stat(c.tlsKey); err != nil {
		return fmt.Errorf("tls key %s: %w", c.tlsKey, err)
	}
	return nil
}

func serveOriginWithConfig(cfg originServeConfig) error {
	bundleDir := originBundleDir(cfg.dataDir)
	if _, err := os.Stat(filepath.Join(bundleDir, originAnchorFile)); err != nil {
		return fmt.Errorf("origin bundle missing in %s — run bootstrap --first first", bundleDir)
	}
	if err := scrubOriginBundleDir(bundleDir); err != nil {
		return err
	}
	if err := cfg.validate(); err != nil {
		return err
	}

	handler := newOriginHTTPHandler(bundleDir)
	addr := ":" + cfg.port
	srv := &http.Server{
		Addr:    addr,
		Handler: handler,
		TLSConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}

	if cfg.tlsCert == "" {
		fmt.Printf("Serving Titan origin bundle at http://0.0.0.0%s/ (whitelist: %s, %s only)\n", addr, originAnchorFile, originGenesisFile)
		return srv.ListenAndServe()
	}

	fmt.Printf("Serving Titan origin bundle at https://0.0.0.0%s/ (TLS enabled)\n", addr)
	return srv.ListenAndServeTLS(cfg.tlsCert, cfg.tlsKey)
}