package main

import (
	"testing"
	"time"
)

func TestRateLimiterAllowsWithinLimit(t *testing.T) {
	t.Parallel()
	lim := newRateLimiter(3, time.Minute)
	for i := 0; i < 3; i++ {
		if !lim.allow("client") {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	if lim.allow("client") {
		t.Fatal("fourth request should be rate limited")
	}
}

func TestRateLimiterResetsPerClient(t *testing.T) {
	t.Parallel()
	lim := newRateLimiter(1, time.Minute)
	if !lim.allow("a") {
		t.Fatal("first request for a should pass")
	}
	if !lim.allow("b") {
		t.Fatal("first request for b should pass")
	}
}
