import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version must be stable semver');
let deploy = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
if (process.env.GITHUB_EVENT_NAME === 'push') {
	const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
	if (event.before && !/^0+$/.test(event.before)) {
		const previous = JSON.parse(
			execFileSync('git', ['show', `${event.before}:package.json`], { encoding: 'utf8' })
		).version;
		deploy = previous !== version;
		if (deploy) {
			const older = previous.split('.').map(Number);
			const newer = version.split('.').map(Number);
			const difference = newer.map((part, i) => part - older[i]).find((part) => part !== 0);
			if (!(difference > 0)) throw new Error('Release version must increase');
		}
	}
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (deploy) {
	try {
		const tagged = execFileSync('git', ['rev-parse', `refs/tags/v${version}^{commit}`], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
		if (tagged !== commit) throw new Error('Version already released from a different commit');
	} catch (error) {
		if (!error.status || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') throw error;
	}
}
appendFileSync(
	process.env.GITHUB_OUTPUT,
	`deploy=${deploy}\nversion=${version}\ncommit=${commit}\n`
);
