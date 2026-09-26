-- Schéma PostgreSQL v1. Créé automatiquement au démarrage.


CREATE TABLE images (
	id VARCHAR(36) NOT NULL, 
	data BYTEA NOT NULL, 
	mime VARCHAR(40) NOT NULL, 
	PRIMARY KEY (id)
)

;

CREATE TABLE knowledge (
	id VARCHAR(36) NOT NULL, 
	title VARCHAR(160) NOT NULL, 
	keywords TEXT NOT NULL, 
	answer TEXT NOT NULL, 
	active BOOLEAN NOT NULL, 
	demo BOOLEAN NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	PRIMARY KEY (id)
)

;

CREATE TABLE login_attempts (
	id VARCHAR(36) NOT NULL, 
	bucket VARCHAR(64) NOT NULL, 
	time INTEGER NOT NULL, 
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_login_attempts_bucket ON login_attempts (bucket);

CREATE TABLE products (
	id VARCHAR(36) NOT NULL, 
	name VARCHAR(160) NOT NULL, 
	code VARCHAR(32) NOT NULL, 
	keywords TEXT NOT NULL, 
	category VARCHAR(80) NOT NULL, 
	image TEXT NOT NULL, 
	note TEXT NOT NULL, 
	active BOOLEAN NOT NULL, 
	demo BOOLEAN NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (code)
)

;

CREATE TABLE search_logs (
	id VARCHAR(36) NOT NULL, 
	device VARCHAR(80) NOT NULL, 
	created_at VARCHAR(40) NOT NULL, 
	kind VARCHAR(20) NOT NULL, 
	query VARCHAR(500) NOT NULL, 
	found BOOLEAN NOT NULL, 
	source VARCHAR(10) NOT NULL, 
	count INTEGER NOT NULL, 
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_search_logs_created_at ON search_logs (created_at);
CREATE INDEX ix_search_logs_found ON search_logs (found);

CREATE TABLE sessions (
	token_hash VARCHAR(64) NOT NULL, 
	role VARCHAR(12) NOT NULL, 
	expires INTEGER NOT NULL, 
	PRIMARY KEY (token_hash)
)

;

CREATE TABLE settings (
	key VARCHAR(80) NOT NULL, 
	value TEXT NOT NULL, 
	PRIMARY KEY (key)
)

;
