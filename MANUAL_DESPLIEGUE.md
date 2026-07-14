# Manual de Despliegue con PM2

Este manual describe los pasos necesarios para desplegar correctamente la aplicación en un entorno de producción utilizando PM2. Los problemas de que la aplicación "no se queda online" suelen deberse a que PM2 está intentando ejecutar el código TypeScript directamente sin compilar, o está apuntando al archivo equivocado.

## 1. Preparación del Entorno....

Asegúrate de estar en la raíz del proyecto y de tener todas las dependencias instaladas:

```bash
npm install
```

## 2. Construir la Aplicación (Build)

Antes de ejecutar la aplicación con PM2, es **estrictamente necesario** compilar el proyecto (tanto el frontend de React como el backend de Node/TypeScript). Ejecuta el siguiente comando:

```bash
npm run build
```
*Nota: Este comando creará o actualizará la carpeta `dist`, generando el archivo `dist/server.cjs` que es el que PM2 debe ejecutar.*

## 3. Detener y Eliminar Procesos Anteriores (Opcional pero Recomendado)

Si tienes versiones anteriores de la aplicación corriendo que están fallando, es mejor detenerlas y eliminarlas de PM2:

```bash
pm2 stop all
pm2 delete all
```
*(Si solo quieres borrar una específica, usa `pm2 delete nombre-app`)*

## 4. Iniciar la Aplicación con PM2

Ahora, iniciaremos la aplicación apuntando al archivo compilado (`dist/server.cjs`) y no al archivo TypeScript original (`server.ts`):

```bash
pm2 start dist/server.cjs --name "loteria-app"
```

## 5. Guardar la Configuración de PM2

Para asegurar que la aplicación vuelva a iniciar automáticamente si el servidor se reinicia, guarda la lista actual de procesos de PM2:

```bash
pm2 save
```

*(Si es la primera vez que configuras PM2 en el servidor para que inicie con el sistema operativo, ejecuta `pm2 startup` y sigue las instrucciones en pantalla antes de `pm2 save`).*

## 6. Comandos Útiles de Mantenimiento

- **Ver el estado de la aplicación:**
  ```bash
  pm2 status
  ```

- **Ver los logs (útil si la app se cae, para ver el error):**
  ```bash
  pm2 logs loteria-app
  ```

- **Reiniciar la aplicación (por ejemplo, después de actualizar el código):**
  1. `git pull` (o como subas tus cambios)
  2. `npm install`
  3. `npm run build`
  4. `pm2 restart loteria-app`

## ¿Por qué se caía la aplicación?
El error común tras actualizaciones al usar Vite y TypeScript es que PM2 intenta usar utilidades de desarrollo (como `tsx` o `ts-node`) o archivos `.ts` en un entorno de producción, lo que consume mucha memoria y eventualmente falla, o simplemente falla la importación de módulos ESM a CJS. Compilar el backend a `dist/server.cjs` con `esbuild` (que ya está configurado en tu `package.json`) y correr eso directamente con Node a través de PM2 soluciona este problema asegurando máxima estabilidad y rendimiento.
