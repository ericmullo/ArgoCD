# Despliegue GitOps con Argo CD y Kubernetes

Repositorio público: https://github.com/ericmullo/ArgoCD

Esta práctica despliega una página web de demostración con dos réplicas iniciales, acceso mediante un Service `NodePort` y escalamiento horizontal por CPU. Argo CD observa la carpeta `k8s/` de la rama `main` y sincroniza los cambios automáticamente.

## Archivos

| Archivo | Función |
| --- | --- |
| `k8s/deployment.yml` | ConfigMap con la página web y Deployment con 2 réplicas, puerto 8080, recursos y sondas de salud. |
| `k8s/service.yml` | Service `NodePort`, puerto 80 hacia el puerto 8080 de los Pods, NodePort 30080. |
| `k8s/hpa.yml` | HPA de CPU al 50 %, entre 2 y 5 réplicas. |
| `k8s/kustomization.yaml` | Agrupa los tres manifiestos para Argo CD. |
| `argocd/application.yml` | Aplicación de Argo CD con sincronización automática, limpieza y autocorrección. |

La página se entrega mediante un ConfigMap dentro de `deployment.yml`; por eso no requiere construir ni publicar una imagen propia. El contenedor usa la imagen pública `nginxinc/nginx-unprivileged:stable-alpine`.

## Requisitos

- Un clúster Kubernetes accesible con `kubectl` y capacidad para descargar la imagen del contenedor.
- Argo CD instalado en el namespace `argocd`.
- Metrics Server operativo, con la API `metrics.k8s.io` disponible, para medir CPU y permitir el HPA.
- Puerto `30080` libre en los nodos. Si está ocupado, cambie `nodePort` en `k8s/service.yml` y suba el cambio a Git.

En Docker Desktop, abra la vista **Kubernetes**, seleccione **Create cluster** y espere a que el contexto `docker-desktop` esté disponible. La [guía oficial de Docker Desktop](https://docs.docker.com/desktop/use-desktop/kubernetes/) muestra la secuencia actual.

Compruebe el contexto antes de aplicar nada:

```powershell
kubectl config current-context
kubectl get nodes
kubectl get apiservice v1beta1.metrics.k8s.io
kubectl top nodes
```

Si Argo CD aún no está instalado, siga la [guía oficial de instalación](https://argo-cd.readthedocs.io/en/stable/getting_started/) y cree el namespace `argocd`. Si falta Metrics Server, siga su [guía oficial](https://github.com/kubernetes-sigs/metrics-server#installation). Ambos son componentes del clúster y se instalan una sola vez.

## Crear la aplicación en Argo CD

Desde la raíz de este repositorio:

```powershell
kubectl apply -f argocd/application.yml
kubectl get application cooperativa-web -n argocd
kubectl get deployment,service,hpa,pods -n gitops-demo
```

Argo CD creará el namespace `gitops-demo` y aplicará los manifiestos de `k8s/`. La ruta `argocd/` está fuera de `k8s/` para que la aplicación no intente instalarse a sí misma.

El Deployment declara `replicas: 2` para la puesta en marcha. Argo CD ignora las diferencias posteriores en ese campo y respeta esa exclusión durante la sincronización, para que el HPA pueda ajustarlo entre 2 y 5 sin que Argo CD lo revierta.

## Verificar la aplicación

```powershell
kubectl rollout status deployment/cooperativa-web -n gitops-demo
kubectl get pods -n gitops-demo -l app=cooperativa-web -o wide
kubectl get service cooperativa-web -n gitops-demo
kubectl get hpa cooperativa-web -n gitops-demo
kubectl top pods -n gitops-demo
```

En un clúster con nodos accesibles desde su equipo, abra `http://<IP_DEL_NODO>:30080`. En Docker Desktop con Kubernetes habilitado puede probar `http://localhost:30080`. Si la red local no expone los puertos de los nodos, pruebe la respuesta web mediante:

```powershell
kubectl port-forward -n gitops-demo service/cooperativa-web 8080:80
```

Luego abra `http://localhost:8080`. `port-forward` verifica la aplicación y el Service, mientras que el acceso por `:30080` verifica además el NodePort.

## Verificar HPA y sincronización

Para generar carga de prueba desde el clúster, en cuatro terminales separadas ejecute el siguiente comando. Manténgalo activo varios minutos y observe el HPA en otra terminal. La CPU consumida depende del clúster y de la intensidad de carga, por lo que no se garantiza una subida con una sola terminal.

```powershell
kubectl run carga-web-1 -n gitops-demo --image=busybox:1.36 --restart=Never -- sh -c 'while true; do wget -q -O /dev/null http://cooperativa-web; done'
kubectl get hpa cooperativa-web -n gitops-demo --watch
```

Use nombres distintos (`carga-web-2`, etc.) para las otras terminales. Cuando termine, elimine únicamente los Pods de carga que haya creado:

```powershell
kubectl delete pod carga-web-1 carga-web-2 carga-web-3 carga-web-4 -n gitops-demo --ignore-not-found
```

El descenso puede tardar unos minutos por la ventana de estabilización del HPA. Para demostrar la sincronización automática, cambie un texto del `ConfigMap` en `k8s/deployment.yml`, suba el commit a `main` y observe `kubectl get application cooperativa-web -n argocd --watch`. Después compruebe el texto actualizado en la página.

## Capturas para el informe individual

Tome capturas **reales** del clúster, con la fecha y el contexto visibles cuando sea posible:

1. Repositorio público mostrando `k8s/deployment.yml`, `k8s/service.yml`, `k8s/hpa.yml` y `argocd/application.yml`.
2. Argo CD con `cooperativa-web` en estado `Synced` y `Healthy`, y sincronización automática activa.
3. `kubectl get deployment,service,hpa,pods -n gitops-demo` mostrando dos Pods y el NodePort `30080`.
4. Navegador abierto en `http://<IP_DEL_NODO>:30080` mostrando la página web.
5. `kubectl top pods -n gitops-demo` y `kubectl get hpa -n gitops-demo --watch` con carga y réplicas incrementadas (si el clúster alcanza el umbral).
6. HPA y Pods tras retirar la carga, cuando las réplicas vuelvan a dos.
7. Commit de cambio en `main` y el historial de sincronización automática de Argo CD.

No presente imágenes simuladas como evidencia de ejecución. Las capturas 2 a 7 requieren un clúster funcionando.
