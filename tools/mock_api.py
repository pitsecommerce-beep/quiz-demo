"""API simulada para probar el front localmente.

Uso:
    python tools/mock_api.py            # escucha en http://localhost:8001

La ruta elige el código de respuesta:
    /200  correcta = opción 2 (acierta si eliges 2)
    /202  /400  /403  /409  /429  /500
    /lento  no responde en 20 s (prueba el tiempo de espera)

Ejemplo: http://localhost:8000/?api=http://localhost:8001/403
"""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BODIES = {
    202: {"estado": "en_cola"},
    400: {"error": "La opción debe ser un número entre 1 y 4."},
    403: {"message": "Forbidden"},
    409: {"error": "Ya respondida"},
    429: {"message": "Too Many Requests"},
    500: {"message": "Internal Server Error"},
}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, x-api-key")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        print("payload:", raw.decode("utf-8", "replace"), "| x-api-key:", self.headers.get("x-api-key"))
        route = self.path.strip("/").split("?")[0] or "200"
        if route == "lento":
            time.sleep(20)
            route = "200"
        code = int(route) if route.isdigit() else 200
        if code == 200:
            body = json.loads(raw or b"{}")
            body = {
                "acierto": body.get("opcion") == 2,
                "correcta": 2,
                "explicacion": "Explicación de prueba <b>sin HTML</b>: la opción 2 es la correcta.",
            }
        else:
            body = BODIES.get(code, {"error": "desconocido"})
        data = json.dumps(body).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8001), Handler).serve_forever()
