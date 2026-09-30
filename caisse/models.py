from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, Boolean, LargeBinary, MetaData, Table

metadata = MetaData()
def now(): return datetime.now(timezone.utc).isoformat()
products = Table('products', metadata,
    Column('id', String(36), primary_key=True), Column('name', String(160), nullable=False),
    Column('code', String(32), nullable=False, unique=True), Column('keywords', Text, nullable=False, default=''),
    Column('category', String(80), nullable=False, default=''), Column('image', Text, nullable=False, default=''),
    Column('note', Text, nullable=False, default=''), Column('active', Boolean, nullable=False, default=True),
    Column('demo', Boolean, nullable=False, default=False), Column('updated_at', String(40), nullable=False))
knowledge = Table('knowledge', metadata,
    Column('id', String(36), primary_key=True), Column('title', String(160), nullable=False),
    Column('keywords', Text, nullable=False), Column('answer', Text, nullable=False),
    Column('active', Boolean, nullable=False, default=True), Column('demo', Boolean, nullable=False, default=False),
    Column('updated_at', String(40), nullable=False))
logs = Table('search_logs', metadata,
    Column('id', String(36), primary_key=True), Column('device', String(80), nullable=False),
    Column('created_at', String(40), nullable=False, index=True), Column('kind', String(20), nullable=False),
    Column('query', String(500), nullable=False), Column('found', Boolean, nullable=False, index=True),
    Column('source', String(10), nullable=False), Column('count', Integer, nullable=False))
settings = Table('settings', metadata, Column('key', String(80), primary_key=True), Column('value', Text, nullable=False))
sessions = Table('sessions', metadata, Column('token_hash', String(64), primary_key=True),
    Column('role', String(12), nullable=False), Column('expires', Integer, nullable=False))
attempts = Table('login_attempts', metadata, Column('id', String(36), primary_key=True),
    Column('bucket', String(64), nullable=False, index=True), Column('time', Integer, nullable=False))
images = Table('images', metadata, Column('id', String(36), primary_key=True),
    Column('data', LargeBinary, nullable=False), Column('mime', String(40), nullable=False))
photo_references = Table('photo_references', metadata,
    Column('id', String(36), primary_key=True), Column('product_id', String(36), nullable=False, index=True),
    Column('model', String(80), nullable=False), Column('embedding', Text, nullable=False),
    Column('data', LargeBinary, nullable=False), Column('active', Boolean, nullable=False, default=True),
    Column('created_at', String(40), nullable=False))
