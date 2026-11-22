package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var payload = map[string]string{
	"image_digest":   "sha256:" + strings.Repeat("a", 64),
	"source_commit":  strings.Repeat("b", 40),
	"version":        "0.0.2",
	"registry_user":  "maxffarrell",
	"registry_token": "test-only",
}

func TestSessionTimestampCreationLagWithoutAllowingExtension(t *testing.T) {
	created := "2026-10-13T00:00:00.001Z"
	for expires, want := range map[string]bool{
		"2026-10-13T00:08:00.000Z": true,
		"2026-10-13T00:08:00.001Z": true,
		"2026-10-13T00:08:00.002Z": false,
		"2026-10-13T00:07:58.999Z": false,
	} {
		if got := validSessionLifetime(created, expires); got != want {
			t.Fatalf("validSessionLifetime(%q)=%v want %v", expires, got, want)
		}
	}
}

func TestRejectsUntrustedImageOrVersion(t *testing.T) {
	for field, value := range map[string]string{
		"image_digest":  "evil/image:latest",
		"source_commit": ";sh",
		"version":       "../x",
		"registry_user": "x;sh",
	} {
		p := map[string]string{}
		for k, v := range payload {
			p[k] = v
		}
		p[field] = value
		if err := validate("leroa", p); err == nil {
			t.Fatalf("validate accepted %s=%q", field, value)
		}
	}
}

func TestFailedVerificationRestoresDatabaseAndImage(t *testing.T) {
	var calls [][]string
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "leroa"), 0o700); err != nil {
		t.Fatal(err)
	}
	oldRoot, oldChdir := root, osChdir
	oldRun, oldInspect, oldReady, oldVerify, oldTemp := run, dockerInspectImage, ready, verify, tempDir
	defer func() {
		root, osChdir = oldRoot, oldChdir
		run, dockerInspectImage, ready, verify, tempDir = oldRun, oldInspect, oldReady, oldVerify, oldTemp
	}()
	root = dir
	osChdir = func(string) error { return nil }
	run = func(args []string, opts runOpts) error {
		calls = append(calls, args)
		for i, a := range args {
			if a == "pg_dump" && opts.stdout != nil {
				_, _ = opts.stdout.Write([]byte("backup"))
				_ = i
			}
		}
		return nil
	}
	dockerInspectImage = func(string) (string, error) { return "sha256:old", nil }
	ready = func(string) error { return nil }
	verify = func(string) error { return errors.New("regression") }
	tempDir = func(_, pattern string) (string, error) { return os.MkdirTemp("", pattern) }
	err := deploy("leroa", payload)
	if err == nil || !strings.Contains(err.Error(), "previous image and database restored") {
		t.Fatalf("deploy error %v", err)
	}
	restore, retag := -1, -1
	for i, a := range calls {
		if len(a) > 0 && a[len(a)-1] == "pg_restore" {
			// unreachable; checked below
		}
		for _, x := range a {
			if x == "pg_restore" && restore < 0 {
				restore = i
			}
		}
		if len(a) >= 3 && a[0] == "docker" && a[1] == "tag" && a[2] == "sha256:old" &&
			strings.HasSuffix(a[len(a)-1], ":latest") {
			retag = i
		}
	}
	if restore < 0 || retag < 0 {
		t.Fatalf("restore=%d retag=%d calls=%v", restore, retag, calls)
	}
	joined := strings.Join(calls[restore], " ")
	if !strings.Contains(joined, "--create") || !strings.Contains(joined, "--exit-on-error") {
		t.Fatal("pg_restore missing flags")
	}
	if strings.Contains(joined, "--single-transaction") {
		t.Fatal("pg_restore must not use --single-transaction")
	}
	if calls[restore][indexOf(calls[restore], "-d")+1] != "postgres" {
		t.Fatal("pg_restore must target postgres db")
	}
	if restore >= retag {
		t.Fatal("restore must run before retag")
	}
	last := calls[len(calls)-1]
	if strings.Join(last, " ") != "docker compose up -d --no-build --pull never" {
		t.Fatalf("last call %v", last)
	}
}

func indexOf(s []string, v string) int {
	for i, x := range s {
		if x == v {
			return i
		}
	}
	return -1
}

// The verify login check must match the copy actually rendered on the sign-in
// page; it silently rolled back releases when the copy changed without it.
func TestDemoLoginMarkerMatchesLoginPage(t *testing.T) {
	page, err := os.ReadFile(filepath.Join(
		"..", "..", "..", "src", "routes", "(auth)", "login", "+page.svelte"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(page), demoLoginMarker) {
		t.Fatalf("login page no longer contains %q; update demoLoginMarker", demoLoginMarker)
	}
	if !demoLoginOK(`<p>Explore a seeded demo — staff view.</p>`) {
		t.Fatal("demoLoginOK rejected current login copy")
	}
	if demoLoginOK(`<p>Try the live demo</p>`) {
		t.Fatal("demoLoginOK accepted stale login copy")
	}
}
