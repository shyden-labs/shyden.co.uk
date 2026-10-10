# The back-translation engine (#95): LibreTranslate, reading id, zh, vi and th
# back into English for .github/workflows/back-translation.yml.
#
# Pinned here rather than in the workflow because Dependabot reads no image
# out of a workflow file: this is the one place it can bump the digest, and
# the tag beside it is what makes that bump reviewable. Both are held by
# tests/unit/supply-chain.test.ts.
#
# Run it locally the same way CI does:
#
#   docker build -t back-translation-engine docker/libretranslate
#   docker run -p 5000:5000 back-translation-engine
#
# The models are in the image (#666): a boot downloads nothing, so it needs
# no network (`docker run --network none` reads every locale back) and
# cannot come up with only some of them.
FROM libretranslate/libretranslate:v1.9.6@sha256:1de2d7056bb8ad607a412f4563d9abe324ff632b43b5be9428bcc8e213aebb32

# Only the languages the site ships: every other model is a download nobody
# reads. The engine names Simplified Chinese `zh` here and `zh-Hans` in its
# API, which is why the script asks for the script, not the code.
ENV LT_LOAD_ONLY=en,id,zh,vi,th

# Every model, installed when the image is BUILT (#666). The image ships with
# none, and a boot used to fetch them: on 2026-10-10 a boot whose DNS was
# failing came up "ready" with 5 of the 8 directions and served anyway, so
# id, vi and th could not be read back at all. Now the download happens once,
# here, and the check below fails the build unless every direction landed,
# because install_models.py does not say when one fails. The check then
# translates once in every direction: the sentence splitter (MiniSBD) fetches
# a model on its first Chinese request, which no model list names, and a boot
# with no network answered zh with a 500 until this ran at build time.
RUN /app/venv/bin/python /app/scripts/install_models.py --load_only_lang_codes "$LT_LOAD_ONLY"
RUN /app/venv/bin/python -c "import os, sys, argostranslate.package as p, argostranslate.translate; got = {(x.from_code, x.to_code) for x in p.get_installed_packages()}; langs = [l for l in os.environ['LT_LOAD_ONLY'].split(',') if l != 'en']; want = {d for l in langs for d in (('en', l), (l, 'en'))}; miss = sorted(want - got); print('models:', sorted(got)); miss and sys.exit(f'missing models: {miss}'); [print(a, '->', b, argostranslate.translate.translate('The words are on this page.', a, b)) for a, b in sorted(want)]"
