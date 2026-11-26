# U.S. Turkey Farms by ZIP Code (Editorial Data App)

Standalone portrait editorial infographic (`850 x 1100` px US Letter proportions) built from USDA Census of Agriculture ZIP-level turkey sales operations (`2007`, `2017`, and `2022`). Designed for GitHub Pages hosting and embedding inside Tableau Public via a Web Page object.

## Local Preview

Browsers block `fetch("./data.json")` over `file://`. Test locally over HTTP:

```bash
py -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## Optional: Plot All 3,886 Individual ZIP Dots

Out of the box, the app renders an accurate 50-state choropleth paired with proportional circles for the verified top commercial hub ZIPs, plus full state-to-ZIP interactive drilldown across all 7,345 unique ZIP codes.

To switch the map automatically to plotting every individual ZIP code dot across the U.S.:

1. **Via GitHub Actions (no local Python needed):** Open your repository's **Actions** tab, select **Enrich ZIP Coordinates (US Census ZCTA)**, and click **Run workflow**. It downloads the official US Census 2020 ZCTA Gazetteer and commits exact coordinates to `data.json`.
2. **Or locally:** Run `python scripts/enrich_zips.py` in this folder, then commit and push `data.json`.

## GitHub Pages and Tableau Public

1. Create a public repository on GitHub and push all files at the root of `main`.
2. Enable **Settings -> Pages -> Deploy from a branch -> `main` / `(root)`**.
3. In Tableau Desktop or Tableau Public Desktop, set a fixed dashboard size of **`850 x 1100` px** (or wider with matching height), drag a **Web Page** object onto the canvas, and paste `https://<username>.github.io/<repo>/`.
