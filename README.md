# Kung Fu Tracker

The page I use to log my kung fu training sessions and competitions: https://zarmat99.github.io/kungfu-tracker/

This repository holds only the code. The data lives in a private repository: the page reads and saves it through the GitHub API, using a fine-grained personal token that stays in the browser.

## Sections

- **Log:** a quick form for a training session, with a button for the double lesson.
- **Calendar:** every session and event by month, with hours by type.
- **Competitions:** the next competition with a countdown and preparation notes, palmarès, every competition with its matches round by round, the record against each opponent, and how each round number tends to go.
- **Progress:** the current season at a glance, the goals ahead (competitions to come and personal milestones such as a grade exam) with a countdown, attendance week by week in every season with the streaks, and hours per season by type. Each chart has its numbers in a table too.

## How it works

- Static site with no build step: plain HTML, CSS and JavaScript modules.
- The data is one JSON file in the private repository, and every save is a commit.
- If two devices save at the same time, the page reloads the file and applies the change again.

## Local development

Serve the folder and open it with `?dev`:

```
python -m http.server 8765
```

Then open http://localhost:8765/?dev. In dev mode the page reads `dev-data.json` (a local copy of the data, ignored by git) and keeps every save in the browser.
