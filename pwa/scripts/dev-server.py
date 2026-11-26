"""Local test server for the PWA with caching turned off, so edits always show. Run: python3 scripts/dev-server.py"""
import http.server, functools, os
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
root = os.path.join(os.path.dirname(__file__), '..')
http.server.ThreadingHTTPServer(('127.0.0.1', 5173), functools.partial(NoCache, directory=root)).serve_forever()
