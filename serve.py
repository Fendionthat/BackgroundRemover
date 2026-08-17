"""Local server for this app. A thin wrapper around Python's built-in
http.server that disables caching on every response.

Why: plain `python -m http.server` sends no Cache-Control header, so
browsers fall back to heuristic caching based on Last-Modified. Since
this app's files (especially the vendored model bundle) get edited in
place during development, a stale cached copy causes confusing
"resource not found" errors after an update -- browsers can hold onto
a cached response even across a hard refresh. This wrapper always
tells the browser to revalidate, which is fast anyway since the
server is local.

Run: python serve.py [port]
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        # Default logging writes to sys.stderr, which is None under
        # pythonw.exe (no console) -- that raises and drops the
        # in-progress connection, breaking every request. The desktop
        # launcher runs this via pythonw specifically so it doesn't
        # flash a console window, so this can't just be left alone.
        try:
            super().log_message(format, *args)
        except Exception:
            pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    directory = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=directory)
    http.server.test(HandlerClass=handler, port=port)
