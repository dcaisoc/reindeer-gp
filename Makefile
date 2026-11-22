# One-command shortcuts. Everything is also available as `npm run <script>`.
.PHONY: dev test ci browsers
dev:          ## install and start the app at http://localhost:8000
	npm install
	npm run dev
test:
	npm test && npm run test:golden
ci:
	npm run ci
browsers:     ## golden traces in Chromium/Firefox, then the end-to-end checks
	npx playwright install chromium firefox
	npm run test:browser
