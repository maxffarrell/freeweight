// Installed by an administrator; invoked only by an app-scoped forced SSH command.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

var root = "/opt/demos"

var apps = map[string]int{"leroa": 3001, "tredaro": 3002, "freeweight": 3003}

type runOpts struct {
	stdin   io.Reader
	stdout  io.Writer
	env     []string
	timeout time.Duration
}

// run executes a command, failing on non-zero exit or timeout (default 120s).
var run = func(args []string, opts runOpts) error {
	if opts.timeout == 0 {
		opts.timeout = 120 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Stdin = opts.stdin
	cmd.Stdout = opts.stdout
	cmd.Stderr = os.Stderr
	if opts.env != nil {
		cmd.Env = opts.env
	}
	return cmd.Run()
}

var osChdir = os.Chdir

var payloadPatterns = map[string]*regexp.Regexp{
	"image_digest":  regexp.MustCompile(`^sha256:[a-f0-9]{64}$`),
	"source_commit": regexp.MustCompile(`^[a-f0-9]{40}$`),
	"version":       regexp.MustCompile(`^\d+\.\d+\.\d+$`),
	"registry_user": regexp.MustCompile(`^[A-Za-z0-9_-]+$`),
}

func validate(app string, payload map[string]string) error {
	if _, ok := apps[app]; !ok {
		return errors.New("unknown app")
	}
	for _, name := range []string{"image_digest", "source_commit", "version", "registry_user"} {
		if !payloadPatterns[name].MatchString(payload[name]) {
			return errors.New("invalid " + name)
		}
	}
	if payload["registry_token"] == "" {
		return errors.New("missing registry credential")
	}
	return nil
}

// Better Auth creates these timestamps separately; observed creation lag is 1 ms.
// Allow a subsecond shorter lifetime, never an extension beyond eight minutes.
func validSessionLifetime(created, expires string) bool {
	parse := func(s string) (time.Time, error) {
		return time.Parse("2006-01-02T15:04:05.999Z07:00", s)
	}
	c, err1 := parse(created)
	e, err2 := parse(expires)
	if err1 != nil || err2 != nil {
		return false
	}
	d := e.Sub(c)
	return d >= 479*time.Second && d <= 480*time.Second
}

var timerRe = regexp.MustCompile(`role="timer"[^>]*>\s*([^<]+)`)
var clockTimerRe = regexp.MustCompile(`^\d+:\d{2}$`)
var sessionIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

var httpClient = func() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar}
}

func get(client *http.Client, url string) (string, string, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", err
	}
	return resp.Request.URL.String(), string(body), nil
}

// demoLoginMarker is copy on the sign-in page shown only in demo mode.
const demoLoginMarker = "Explore a seeded demo"

func demoLoginOK(body string) bool { return strings.Contains(body, demoLoginMarker) }

// verify is a var so tests can stub it.
var verify = func(app string) error {
	base := fmt.Sprintf("https://%s.173.249.220.229.nip.io", app)
	client := httpClient()
	_, login, err := get(client, base+"/login")
	if err != nil {
		return err
	}
	if !demoLoginOK(login) {
		return errors.New("demo login missing")
	}
	req, err := http.NewRequest(http.MethodPost, base+"/demo", strings.NewReader(""))
	if err != nil {
		return err
	}
	req.Header.Set("Origin", base)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if !strings.HasSuffix(resp.Request.URL.String(), "/dashboard") {
		return errors.New("demo creation failed")
	}
	_, sessionBody, err := get(client, base+"/api/auth/get-session")
	if err != nil {
		return err
	}
	var sessionData struct {
		Session struct {
			ID        string `json:"id"`
			CreatedAt string `json:"createdAt"`
			ExpiresAt string `json:"expiresAt"`
		} `json:"session"`
	}
	if err := json.Unmarshal([]byte(sessionBody), &sessionData); err != nil {
		return err
	}
	session := sessionData.Session
	if !validSessionLifetime(session.CreatedAt, session.ExpiresAt) {
		return errors.New("session lifetime changed")
	}
	timer := func() (int, error) {
		url, body, err := get(client, base+"/dashboard")
		if err != nil {
			return 0, err
		}
		m := timerRe.FindStringSubmatch(body)
		if !strings.HasSuffix(url, "/dashboard") || m == nil || !clockTimerRe.MatchString(strings.TrimSpace(m[1])) {
			return 0, errors.New("demo countdown missing")
		}
		var mins, secs int
		if _, err := fmt.Sscanf(strings.TrimSpace(m[1]), "%d:%d", &mins, &secs); err != nil {
			return 0, err
		}
		return mins*60 + secs, nil
	}
	first, err := timer()
	if err != nil {
		return err
	}
	time.Sleep(2 * time.Second)
	second, err := timer()
	if err != nil {
		return err
	}
	if !(0 < second && second < first && first <= 480) {
		return errors.New("countdown failed")
	}
	_, sessionBody, err = get(client, base+"/api/auth/get-session")
	if err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(sessionBody), &sessionData); err != nil {
		return err
	}
	if sessionData.Session.ExpiresAt != session.ExpiresAt {
		return errors.New("session refreshed")
	}
	sid := session.ID
	if !sessionIDRe.MatchString(sid) {
		return errors.New("invalid session ID")
	}
	expire := fmt.Sprintf(
		"UPDATE session SET expires_at=now()-INTERVAL '1 second' WHERE id='%s';", sid)
	if err := run(
		[]string{"docker", "exec", "-i", app + "-db-1", "psql", "-U", app, "-d", app,
			"-v", "ON_ERROR_STOP=1", "-At"},
		runOpts{stdin: strings.NewReader(expire), stdout: io.Discard},
	); err != nil {
		return err
	}
	url, _, err := get(client, base+"/dashboard")
	if err != nil {
		return err
	}
	if path := respPath(url); path != "/login" {
		return errors.New("expired session accepted")
	}
	if err := run(
		[]string{"systemctl", "is-active", "--quiet", "caddy", "demo-cpu-guard.timer"},
		runOpts{},
	); err != nil {
		return err
	}
	health, err := inspectHealth(app)
	if err != nil {
		return err
	}
	if health != "healthy" {
		return errors.New("database unhealthy")
	}
	fmt.Printf("%s: HTTPS demo, countdown, fixed expiry, database and CPU guard verified\n", app)
	return nil
}

func respPath(rawurl string) string {
	i := strings.Index(rawurl, "://")
	if i < 0 {
		return rawurl
	}
	rest := rawurl[i+3:]
	j := strings.Index(rest, "/")
	if j < 0 {
		return "/"
	}
	p := rest[j:]
	if k := strings.IndexAny(p, "?#"); k >= 0 {
		p = p[:k]
	}
	return p
}

// dockerInspectImage and inspectHealth are vars so tests can stub them.
var dockerInspectImage = func(name string) (string, error) {
	out, err := exec.Command(
		"docker", "inspect", "--format", "{{.Image}}", name,
	).Output()
	return strings.TrimSpace(string(out)), err
}

var inspectHealth = func(app string) (string, error) {
	out, err := exec.Command(
		"docker", "inspect", "--format", "{{.State.Health.Status}}", app+"-db-1",
	).Output()
	return strings.TrimSpace(string(out)), err
}

// ready is a var so tests can stub it.
var ready = func(app string) error {
	client := &http.Client{Timeout: 2 * time.Second}
	for range 60 {
		resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/login", apps[app]))
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return nil
			}
		}
		time.Sleep(time.Second)
	}
	return errors.New("app did not become ready")
}

var tempDir = func(dir, pattern string) (string, error) {
	return os.MkdirTemp(dir, pattern)
}

func deploy(app string, payload map[string]string) error {
	if err := validate(app, payload); err != nil {
		return err
	}
	if err := osChdir(filepath.Join(root, app)); err != nil {
		return err
	}
	image := "ghcr.io/maxffarrell/" + app
	immutable := image + "@" + payload["image_digest"]
	config, err := tempDir("/run", "demo-registry-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(config)
	env := append(os.Environ(), "DOCKER_CONFIG="+config)
	if err := run(
		[]string{"docker", "login", "ghcr.io", "--username", payload["registry_user"], "--password-stdin"},
		runOpts{stdin: strings.NewReader(payload["registry_token"]), stdout: io.Discard, env: env},
	); err != nil {
		return err
	}
	if err := run([]string{"docker", "pull", immutable}, runOpts{env: env, timeout: 300 * time.Second}); err != nil {
		return err
	}
	old, err := dockerInspectImage(app + "-app-1")
	if err != nil {
		return err
	}
	stamp := time.Now().UTC().Format("20060102T150405Z")
	rollback := image + ":rollback-" + stamp
	if err := run([]string{"docker", "tag", old, rollback}, runOpts{}); err != nil {
		return err
	}
	folder := filepath.Join(root, "backups", app)
	if err := os.MkdirAll(folder, 0o700); err != nil {
		return err
	}
	backup := filepath.Join(folder, stamp+".dump")
	backedUp := false
	deployErr := func() error {
		if err := run([]string{"docker", "compose", "stop", "app"}, runOpts{}); err != nil {
			return err
		}
		f, err := os.Create(backup)
		if err != nil {
			return err
		}
		err = run(
			[]string{"docker", "exec", app + "-db-1", "pg_dump", "-U", app, "-d", app, "-Fc"},
			runOpts{stdout: f},
		)
		f.Close()
		if err != nil {
			return err
		}
		if st, err := os.Stat(backup); err != nil || st.Size() == 0 {
			return errors.New("empty database backup")
		}
		backedUp = true
		if err := run([]string{"docker", "tag", immutable, image + ":latest"}, runOpts{}); err != nil {
			return err
		}
		if err := run([]string{"docker", "compose", "up", "-d", "--no-build", "--pull", "never"}, runOpts{}); err != nil {
			return err
		}
		if err := ready(app); err != nil {
			return err
		}
		if err := verify(app); err != nil {
			return err
		}
		release := map[string]string{
			"image_digest":  payload["image_digest"],
			"source_commit": payload["source_commit"],
			"version":       payload["version"],
		}
		data, _ := json.Marshal(release)
		if err := os.WriteFile("release.json", data, 0o600); err != nil {
			return err
		}
		fmt.Printf("%s release %s deployed; rollback tag %s\n", app, payload["version"], rollback)
		return nil
	}()
	if deployErr == nil {
		return nil
	}
	fmt.Fprintln(os.Stderr, "Deployment failed; restoring previous release")
	_ = run([]string{"docker", "compose", "stop", "app"}, runOpts{})
	if backedUp {
		f, err := os.Open(backup)
		if err == nil {
			_ = run(
				[]string{"docker", "exec", "-i", app + "-db-1", "pg_restore", "-U", app,
					"-d", "postgres", "--clean", "--if-exists", "--create", "--no-owner",
					"--exit-on-error"},
				runOpts{stdin: f},
			)
			f.Close()
		}
	}
	_ = run([]string{"docker", "tag", old, image + ":latest"}, runOpts{})
	_ = run([]string{"docker", "compose", "up", "-d", "--no-build", "--pull", "never"}, runOpts{})
	_ = ready(app)
	return errors.New("release rejected; previous image and database restored")
}

func runDeploy() error {
	umask := syscall.Umask(0o077)
	defer syscall.Umask(umask)
	if len(os.Args) < 2 {
		return errors.New("unknown app")
	}
	app := os.Args[1]
	if _, ok := apps[app]; !ok {
		return errors.New("unknown app")
	}
	switch command := os.Getenv("SSH_ORIGINAL_COMMAND"); command {
	case "probe":
		fmt.Println("Restricted deployment key ready for " + app)
		return nil
	case "deploy":
	default:
		return errors.New("only deploy and probe commands are permitted")
	}
	data, err := io.ReadAll(io.LimitReader(os.Stdin, 16384))
	if err != nil {
		return err
	}
	var payload map[string]string
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	if err := validate(app, payload); err != nil {
		return err
	}
	if err := os.MkdirAll("/run/lock", 0o755); err != nil {
		return err
	}
	lock, err := os.OpenFile("/run/lock/demo-release.lock", os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	return deploy(app, payload)
}

func main() {
	if err := runDeploy(); err != nil {
		// Never emit request contents, credentials, or subprocess arguments.
		fmt.Fprintln(os.Stderr, "Demo deployment failed: "+reflectType(err))
		os.Exit(1)
	}
}

func reflectType(err error) string {
	name := fmt.Sprintf("%T", err)
	return strings.TrimPrefix(name, "*errors.")
}
