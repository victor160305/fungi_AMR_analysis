# Fungi Analysis Tool

## GitHub Pages deployment

Pushing to `main` runs the GitHub Actions workflow, builds the frontend, and publishes `dist/` to the `gh-pages` branch.

In the repository's **Settings → Pages**, select **Deploy from a branch**, then choose **gh-pages** and **/(root)**. The site is available at:

`https://victor160305.github.io/fungi_AMR_analysis/`

GitHub Pages hosts only the static frontend and files in `public/`. API-backed features such as uploads require the separate Node.js server and are not available on Pages alone.
