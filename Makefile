UUID := glass-dock@pdrmottadev.github.io
OLD_UUID := glass-dock@pdrmotta.github.io
EXT_ROOT := $(HOME)/.local/share/gnome-shell/extensions
EXT_DIR := $(EXT_ROOT)/$(UUID)
DOMAIN := glass-dock
JS := extension.js prefs.js $(wildcard src/*.js)
LANGS := $(shell cat po/LINGUAS)
VERSION := $(shell sed -n 's/.*"version-name": "\(.*\)".*/\1/p' metadata.json)

.PHONY: all schemas locale install uninstall enable disable prefs pot lint check test test-gnome50 pack release logs clean

all: schemas locale

schemas:
	glib-compile-schemas --strict schemas/

# Compiled translations for running from the source tree (pack builds its own).
locale:
	@for l in $(LANGS); do \
		mkdir -p locale/$$l/LC_MESSAGES; \
		msgfmt --check -o locale/$$l/LC_MESSAGES/$(DOMAIN).mo po/$$l.po; \
	done

# Symlinks the working tree into the user's extensions folder.
install: schemas locale
	mkdir -p $(EXT_ROOT)
	rm -f $(EXT_ROOT)/$(OLD_UUID)
	ln -sfn $(CURDIR) $(EXT_DIR)
	@echo "Installed -> $(EXT_DIR)"
	@echo "On Wayland, log out and back in, then: make enable"

uninstall:
	rm -f $(EXT_DIR)

enable:
	-gnome-extensions disable $(OLD_UUID)
	-gnome-extensions disable dash-to-dock@micxgx.gmail.com
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

prefs:
	gnome-extensions prefs $(UUID)

pot:
	xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ \
		--add-comments=Translators --package-name=$(DOMAIN) \
		--package-version=$(VERSION) \
		--msgid-bugs-address=https://github.com/pdrmottadev/glass_dock/issues \
		-o po/$(DOMAIN).pot $(JS)
	@for l in $(LANGS); do msgmerge --update --backup=none po/$$l.po po/$(DOMAIN).pot; done

lint:
	npx eslint .

# Quick syntax check without npm.
check:
	@for f in $(JS); do node --check $$f || exit 1; done; echo "syntax OK"

# End-to-end tests in an isolated headless GNOME Shell (see tests/headless).
test: schemas
	tests/headless/run.sh

# Same tests against GNOME Shell 50, in a Fedora 44 container (podman).
test-gnome50: schemas
	tests/container/run-gnome50.sh

pack: schemas
	mkdir -p dist
	gnome-extensions pack --force --out-dir=dist \
		--extra-source=src \
		--extra-source=LICENSE \
		--schema=schemas/org.gnome.shell.extensions.glass-dock.gschema.xml \
		--podir=po \
		--gettext-domain=$(DOMAIN) \
		.

release: lint test pack
	@cp dist/$(UUID).shell-extension.zip dist/glass-dock-v$(VERSION).zip
	@echo "Release zip: dist/glass-dock-v$(VERSION).zip"

logs:
	journalctl -f -o cat /usr/bin/gnome-shell | grep -i --line-buffered -E "glass|JS ERROR"

clean:
	rm -rf dist locale schemas/gschemas.compiled
