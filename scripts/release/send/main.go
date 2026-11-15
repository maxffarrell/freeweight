// Sends a signed deploy request to the demo server's forced SSH command.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var sshRun = func(args []string, stdin string) error {
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Stdin = strings.NewReader(stdin)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	timer := time.AfterFunc(900*time.Second, func() { _ = cmd.Process.Kill() })
	defer timer.Stop()
	return cmd.Run()
}

func run(env func(string) string, ssh func([]string, string) error) error {
	dir, err := os.MkdirTemp("", "demo-release-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	key := dir + "/key"
	if err := os.WriteFile(key, []byte(strings.TrimRight(env("DEMO_SSH_KEY"), "\n")+"\n"), 0o600); err != nil {
		return err
	}
	_, src, _, _ := runtime.Caller(0)
	knownHosts := filepath.Join(filepath.Dir(src), "..", "known_hosts")
	payload, err := json.Marshal(map[string]string{
		"image_digest":   env("IMAGE_DIGEST"),
		"registry_user":  env("GITHUB_REPOSITORY_OWNER"),
		"registry_token": env("GH_TOKEN"),
		"source_commit":  env("SOURCE_COMMIT"),
		"version":        env("RELEASE_VERSION"),
	})
	if err != nil {
		return err
	}
	return ssh([]string{
		"ssh", "-i", key,
		"-o", "BatchMode=yes",
		"-o", "IdentitiesOnly=yes",
		"-o", "StrictHostKeyChecking=yes",
		"-o", "UserKnownHostsFile=" + knownHosts,
		"-o", "ConnectTimeout=15",
		"root@173.249.220.229", "deploy",
	}, string(payload))
}

func main() {
	old := maskUmask()
	defer restoreUmask(old)
	if err := run(os.Getenv, sshRun); err != nil {
		fmt.Fprintln(os.Stderr, "Deploy request failed")
		os.Exit(1)
	}
}
