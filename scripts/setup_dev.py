"""Generate local-only credentials; never commits or prints secrets."""
import secrets
from pathlib import Path
root=Path(__file__).resolve().parent.parent
p=root/'.env'
if p.exists():
 print('.env existe déjà : conservé sans modification.')
else:
 password=secrets.token_urlsafe(18)
 p.write_text('APP_ENV=development\nSECRET_KEY='+secrets.token_urlsafe(48)+'\nADMIN_PASSWORD='+password+'\nKIOSK_PIN=\nSEED_DEMO=true\nLOG_RETENTION_DAYS=30\n')
 p.chmod(0o600)
 print('Configuration locale créée dans .env. Le mot de passe admin se trouve dans ADMIN_PASSWORD. Ne partagez pas ce fichier.')
