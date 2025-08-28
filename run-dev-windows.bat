\
@echo off
echo Instalando dependências...
npm install
if not exist ".env" (
  copy ".env.sample" ".env"
)
echo Iniciando servidor...
npx cross-env NODE_ENV=development node server.js
pause
