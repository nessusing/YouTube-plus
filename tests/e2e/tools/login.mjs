// Opens Playwright's Chromium on the e2e profile *without* automation, so
// Google lets you sign in. Sign in to YouTube, then close the window.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const profile = process.env.YTPP_E2E_PROFILE ?? join(homedir(), '.cache', 'ytpp-e2e-profile');
mkdirSync(profile, { recursive: true });
console.log(`Profile: ${profile}\nSign in to YouTube in the window that opens, then close it.`);
const child = spawn(chromium.executablePath(), [
  `--user-data-dir=${profile}`,
  '--lang=en-US',
  '--no-first-run',
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
], { stdio: 'ignore' });
child.on('exit', () => console.log('Closed. Now: npm run test:e2e'));
