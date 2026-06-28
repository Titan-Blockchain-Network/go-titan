package main

import (
	"sync"
	"time"
)

type rateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	counts  map[string]int
	resetAt map[string]time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{
		limit:   limit,
		window:  window,
		counts:  make(map[string]int),
		resetAt: make(map[string]time.Time),
	}
}

func (r *rateLimiter) allow(key string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	if reset, ok := r.resetAt[key]; !ok || now.After(reset) {
		r.counts[key] = 0
		r.resetAt[key] = now.Add(r.window)
	}
	if r.counts[key] >= r.limit {
		return false
	}
	r.counts[key]++
	return true
}
