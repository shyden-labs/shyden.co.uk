# The image CI's browser jobs run in (#431, #454). Pinned by digest beside
# its version; Dependabot's docker ecosystem keeps it current, and
# scripts/playwright-image.mjs uses it whenever its version is the installed
# @playwright/test's (and resolves that version's digest when it is not).
FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579
# Never root (SonarCloud S6471, #1277): `pwuser` is the image's own
# unprivileged user. Nothing builds this file; it pins the image.
USER pwuser
