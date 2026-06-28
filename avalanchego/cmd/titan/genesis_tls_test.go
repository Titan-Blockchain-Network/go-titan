package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestOriginServeConfigValidateTLS(t *testing.T) {
	dir := t.TempDir()
	cert := filepath.Join(dir, "cert.pem")
	key := filepath.Join(dir, "key.pem")
	if err := os.WriteFile(cert, []byte("cert"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(key, []byte("key"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := originServeConfig{dataDir: dir, port: "9652", tlsCert: cert, tlsKey: key}
	if err := cfg.validate(); err != nil {
		t.Fatalf("expected valid tls config: %v", err)
	}

	if err := (originServeConfig{port: "9652", tlsCert: cert}).validate(); err == nil {
		t.Fatal("expected error when tls-key missing")
	}
	if err := (originServeConfig{port: "9652", tlsKey: key}).validate(); err == nil {
		t.Fatal("expected error when tls-cert missing")
	}
}

func TestOriginHandlerSecurityHeaders(t *testing.T) {
	dir := t.TempDir()
	handler := newOriginHTTPHandler(dir)

	req := httptest.NewRequest(http.MethodGet, "/anchor.json", nil)
	req.RemoteAddr = "1.2.3.4:1234"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff header")
	}
	if rec.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("missing frame deny header")
	}
}
