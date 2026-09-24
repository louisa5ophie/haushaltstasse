# HaushaltsTasse 0.2 – blitz.cloud-ready

Diese Version ist für blitz.cloud + PostgreSQL vorbereitet.

## Enthalten
- 55 Aufgaben und Jahresplan
- Monats-Tasse
- Zwei Benutzer: Louisa und Patrick
- Passwort-Login
- serverseitige Sitzungen (HttpOnly/Secure/SameSite)
- PostgreSQL-Speicherung
- Aufgaben-Zuteilungen und Erledigungen werden zwischen Geräten synchronisiert
- Dockerfile, Port 8080

## Wichtiger blitz.cloud-Hinweis
Die aktuelle blitz.cloud-Dokumentation (Sept. 2026) erlaubt eigenen Code direkt aus GitHub nur für öffentliche Repositories; die Karte „My own code“ ist noch als „Soon“ markiert. Für den kostenlosen Eigen-Code-Weg muss das Docker-Image daher öffentlich auf Docker Hub liegen oder über einen später verfügbaren GitHub-Weg bereitgestellt werden.

Für die Datenbank: im blitz.cloud-Wizard „Needs a database → PostgreSQL“ aktivieren. DATABASE_URL wird intern gesetzt. Die Datenbank hat keine öffentliche Adresse und wird nachts gesichert.

## Umgebungsvariablen
LOUISA_PASSWORD = gewünschtes Passwort für Louisa
PATRICK_PASSWORD = gewünschtes Passwort für Patrick
SESSION_SECRET = optional (für spätere Erweiterung; aktuelle Session-Tokens sind zufällig)

Die beiden Passwörter werden nur beim ersten Start zum Anlegen der Benutzer verwendet. Nicht in den Quellcode schreiben.
