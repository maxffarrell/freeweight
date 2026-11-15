package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func plan(t *testing.T, eventName, oldVersion, newVersion string, beforeZero bool) string {
	t.Helper()
	root := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		cmd.Stderr = nil
		if err := cmd.Run(); err != nil {
			t.Fatalf("git %v: %v", args, err)
		}
	}
	run("init")
	run("config", "user.email", "test@example.invalid")
	run("config", "user.name", "Test")
	writePkg := func(v string) {
		data, _ := json.Marshal(map[string]string{"version": v})
		if err := os.WriteFile(filepath.Join(root, "package.json"), append(data, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writePkg(oldVersion)
	run("add", ".")
	run("commit", "-m", "Initial")
	before := execGit(t, root, "rev-parse", "HEAD")
	writePkg(newVersion)
	eventBefore := before
	if beforeZero {
		eventBefore = strings.Repeat("0", 40)
	}
	event, _ := json.Marshal(map[string]string{"before": eventBefore})
	if err := os.WriteFile(filepath.Join(root, "event.json"), event, 0o600); err != nil {
		t.Fatal(err)
	}
	if eventName == "workflow_dispatch" {
		run("tag", "v"+newVersion)
	}
	env := append(os.Environ(),
		"GITHUB_EVENT_NAME="+eventName,
		"GITHUB_EVENT_PATH="+filepath.Join(root, "event.json"),
		"GITHUB_OUTPUT="+filepath.Join(root, "output"),
	)
	planPath, err := filepath.Abs(filepath.Join("..", "plan.ts"))
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("node", planPath)
	cmd.Dir = root
	cmd.Env = env
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("plan.ts: %v\n%s", err, out)
	}
	out, err := os.ReadFile(filepath.Join(root, "output"))
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func execGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return strings.TrimSpace(string(out))
}

func TestOrdinaryCommitDoesNotDeploy(t *testing.T) {
	if !strings.Contains(plan(t, "push", "0.0.1", "0.0.1", false), "deploy=false") {
		t.Fatal("expected deploy=false")
	}
}

func TestVersionMergeDeploys(t *testing.T) {
	if !strings.Contains(plan(t, "push", "0.0.1", "0.0.2", false), "deploy=true") {
		t.Fatal("expected deploy=true")
	}
}

func TestManualRetryDeploys(t *testing.T) {
	if !strings.Contains(plan(t, "workflow_dispatch", "0.0.1", "0.0.1", false), "deploy=true") {
		t.Fatal("expected deploy=true")
	}
}

func TestPrNeverDeploys(t *testing.T) {
	if !strings.Contains(plan(t, "pull_request", "0.0.1", "0.0.2", false), "deploy=false") {
		t.Fatal("expected deploy=false")
	}
}

func TestInitialPushDoesNotDeploy(t *testing.T) {
	if !strings.Contains(plan(t, "push", "0.0.1", "0.0.2", true), "deploy=false") {
		t.Fatal("expected deploy=false")
	}
}
