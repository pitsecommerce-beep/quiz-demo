# Quiz

Página estática (sin build ni dependencias) en `front/`. Se despliega en AWS Amplify con GitHub Actions.

## Probar localmente

```bash
cd front && python -m http.server 8000
```

```bash
python tools/mock_api.py
```

Abre `http://localhost:8000/?api=http://localhost:8001/200`. Cambia `200` por `202`, `400`, `403`, `409`, `429` o `500` para ver cada caso. `?desde=1&hasta=5` recorta el rango de preguntas.

## Preguntas

Pega las 15 preguntas reales en `front/questions.json` con el formato `{ id, bloque, q, a, t }`. Nunca incluyas la respuesta correcta: el workflow rechaza cualquier campo extra.

## Despliegue con GitHub Actions

El workflow `.github/workflows/deploy.yml` verifica el código en cada PR y, en cada push a `main`, despliega `front/` en Amplify. `config.js` se genera en el despliegue a partir de secretos, así que en el repositorio solo quedan valores de ejemplo.

### 1. Amplify

1. En la consola de Amplify crea una app con **Deploy without Git** (despliegue manual).
2. Crea una rama, por ejemplo `main`. Anota el **App ID**.

### 2. Rol de IAM (OIDC, sin llaves de acceso)

1. En IAM agrega el proveedor de identidad `token.actions.githubusercontent.com` (audiencia `sts.amazonaws.com`) si no existe.
2. Crea un rol con esta relación de confianza (ajusta cuenta y repo):

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::<CUENTA>:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<OWNER>/<REPO>:environment:production" }
  }
}
```

3. Permisos mínimos del rol:

```json
{
  "Effect": "Allow",
  "Action": ["amplify:CreateDeployment", "amplify:StartDeployment", "amplify:GetJob"],
  "Resource": "arn:aws:amplify:<REGION>:<CUENTA>:apps/<APP_ID>/branches/*"
}
```

### 3. GitHub

En **Settings → Environments** crea el entorno `production` y agrega:

| Tipo | Nombre | Valor |
|---|---|---|
| Secret | `AWS_ROLE_ARN` | ARN del rol |
| Secret | `QUIZ_API_URL` | URL del endpoint POST |
| Secret | `QUIZ_API_KEY` | Llave de API Gateway |
| Variable | `AWS_REGION` | p. ej. `us-east-1` |
| Variable | `AMPLIFY_APP_ID` | App ID de Amplify |
| Variable | `AMPLIFY_BRANCH` | p. ej. `main` |

La llave de API viaja al navegador de todos modos; protégela con un *usage plan* y límites en API Gateway, y configura CORS para aceptar solo el dominio de Amplify.
