# Former22 (middleware)

## Archive Mode

Archive allow return only usefull informations by years

It can to be enabled by environment variable

```
ARCHIVE_MODE=1
```

0 = current year - 1\
1 = older years

## Mail en local

En local, si `MAILER_HOST_URL` n'est pas defini, le middleware simule l'envoi d'e-mails au lieu d'appeler Postal.

En production, le host par defaut reste `https://postal.cep-val.ch`.
