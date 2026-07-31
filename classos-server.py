#!/usr/bin/env python3
"""
ClassOS local server.

Plain file serving, exactly like `python3 -m http.server`, plus ONE extra:
a POST to /classos/shutdown stops the server. That is what makes the app's
"Backup & Close" button able to genuinely close the classroom down instead of
telling the teacher to go find a black window and close it himself.

Nothing here is reachable from outside this computer: the server binds to
localhost only, so no other machine on the school network can see it, let
alone shut it down.
"""

import http.server
import socketserver
import sys
import threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
HOST = "127.0.0.1"          # localhost ONLY — never the school network


class ClassOSHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/classos/shutdown":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
            # Stop from another thread: shutdown() blocks until the serve loop
            # ends, and calling it from inside a request handler would wait on
            # itself forever.
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        self.send_error(404)

    def log_message(self, fmt, *args):
        # A quiet window. The teacher should see the banner, not a request log.
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    print("")
    print("  ==============================================")
    print("    Mr. D's Classroom OS is running.")
    print("")
    print("    Leave this window open while you teach.")
    print("    Closing it shuts the classroom down.")
    print("  ==============================================")
    print("")
    try:
        with Server((HOST, PORT), ClassOSHandler) as httpd:
            httpd.serve_forever()
    except OSError as e:
        print(f"  Could not start on port {PORT}: {e}")
        print("  The classroom may already be open in another window.")
        return 1
    print("")
    print("  The classroom has been closed down. This window can be closed.")
    print("")
    return 0


if __name__ == "__main__":
    sys.exit(main())
