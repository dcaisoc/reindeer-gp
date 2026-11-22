# Notebooks

Three ready-to-run notebooks. Click a badge to open it on Google Colab (free; sign in with any Google account), then run the cells with **Shift+Enter**. The first cell installs the SDK.

| Notebook | Level | Time | What you'll do |
| --- | --- | --- | --- |
| **01 · Imitation with PyTorch** [![Open in Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/dcaisoc/reindeer-gp/blob/main/notebooks/01-imitation.ipynb) | Reindeer | 10 min | Upload your laps, train a network in PyTorch, race it with the official engine, submit. |
| **02 · Which senses matter?** [![Open in Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/dcaisoc/reindeer-gp/blob/main/notebooks/02-compare-inputs.ipynb) | Reindeer | 2 min | Compare input choices and training data; see generalisation to unseen tracks. |
| **03 · Neuroevolution** [![Open in Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/dcaisoc/reindeer-gp/blob/main/notebooks/03-neuroevolution.ipynb) | Santa | 3 min | Evolve a driver from random networks, with no laps at all. |

No laps yet? Every notebook falls back to sample laps from a simulated driver, so you can run it straight away and swap in your own later.

## Running them on your own computer

```sh
pip install "reindeer-sdk[torch] @ git+https://github.com/dcaisoc/reindeer-gp#subdirectory=sdk" jupyter matplotlib
git clone https://github.com/dcaisoc/reindeer-gp && cd reindeer-gp/notebooks && jupyter lab
```

## For maintainers

The notebooks are generated from plain Python files in `notebooks/src/` (cells start with `# %%`), which review well in pull requests. After editing, run `python3 scripts/build_notebooks.py`; CI fails if the `.ipynb` files are out of date, and it runs every notebook from top to bottom.
