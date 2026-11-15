package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestKeyIsPrivateAndRemovedAfterSuccessOrFailure(t *testing.T) {
	env := map[string]string{
		"DEMO_SSH_KEY":            "test_not_real_ssh_key",
		"IMAGE_DIGEST":            "sha256:" + strings.Repeat("a", 64),
		"GITHUB_REPOSITORY_OWNER": "maxffarrell",
		"GH_TOKEN":                "test_not_real_registry_token",
		"SOURCE_COMMIT":           strings.Repeat("b", 40),
		"RELEASE_VERSION":         "0.0.2",
	}
	for _, fail := range []bool{false, true} {
		var keyPath string
		ssh := func(args []string, stdin string) error {
			for i, a := range args {
				if a == "-i" {
					keyPath = args[i+1]
				}
			}
			if keyPath == "" {
				t.Fatal("ssh invoked without -i key")
			}
			st, err := os.Stat(keyPath)
			if err != nil {
				t.Fatal(err)
			}
			if got := st.Mode().Perm(); got != 0o600 {
				t.Fatalf("key mode %v", got)
			}
			dst, err := os.Stat(filepath.Dir(keyPath))
			if err != nil {
				t.Fatal(err)
			}
			if got := dst.Mode().Perm(); got != 0o700 {
				t.Fatalf("dir mode %v", got)
			}
			joined := strings.Join(args, " ")
			if !strings.Contains(joined, "StrictHostKeyChecking=yes") {
				t.Fatal("missing StrictHostKeyChecking")
			}
			if fail {
				return errors.New("ssh failed")
			}
			return nil
		}
		old := syscall.Umask(0o077)
		err := run(func(k string) string { return env[k] }, ssh)
		syscall.Umask(old)
		if fail && err == nil {
			t.Fatal("expected failure")
		}
		if !fail && err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(keyPath); !os.IsNotExist(err) {
			t.Fatal("key not removed")
		}
		if _, err := os.Stat(filepath.Dir(keyPath)); !os.IsNotExist(err) {
			t.Fatal("key dir not removed")
		}
	}
}
