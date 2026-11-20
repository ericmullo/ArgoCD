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
| `cluster-setup/` | Ajustes locales para Metrics Server, generador temporal de carga y script de evidencias. |

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

En este Docker Desktop, la instalación de Argo CD necesitó `kubectl apply --server-side --force-conflicts -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml` porque una CRD superó el límite de anotaciones de `kubectl apply` convencional. Metrics Server necesitó el ajuste local `cluster-setup/metrics-server-local-tls-patch.json` porque el certificado del kubelet no se pudo validar desde su contenedor. Ese parche usa `--kubelet-insecure-tls` **solo para este clúster de desarrollo**. En un clúster de producción se debe configurar la autoridad certificadora correcta en su lugar.

```powershell
kubectl create namespace argocd
kubectl apply --server-side --force-conflicts -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system --type=json --patch-file cluster-setup/metrics-server-local-tls-patch.json
```

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

En un clúster con nodos accesibles desde su equipo, abra `http://<IP_DEL_NODO>:30080`. El clúster `kind` de este Docker Desktop no publicó el NodePort en `localhost:30080`; se comprobó desde el nodo con `docker exec desktop-control-plane curl -sS -o /dev/null -w '%{http_code}' http://172.20.0.2:30080`, que devolvió `200`. Para abrir la web desde Windows, use:

```powershell
kubectl port-forward -n gitops-demo service/cooperativa-web 18080:80
```

Luego abra `http://localhost:18080`. `port-forward` verifica la aplicación y el Service, mientras que el acceso desde el nodo por `:30080` verifica además el NodePort.

## Verificar HPA y sincronización

Para generar carga de prueba desde el clúster, aplique el Deployment temporal de la carpeta `cluster-setup/` y observe el HPA. Los 12 Pods del generador consiguieron que la web subiera de dos a tres réplicas en este clúster.

```powershell
kubectl apply -f cluster-setup/load-test.yml
kubectl get hpa cooperativa-web -n gitops-demo --watch
```

Cuando termine, elimine el generador de carga:

```powershell
kubectl delete -f cluster-setup/load-test.yml
```

El descenso puede tardar unos minutos por la ventana de estabilización del HPA. Para demostrar la sincronización automática, cambie un texto del `ConfigMap` en `k8s/deployment.yml`, suba el commit a `main` y observe `kubectl get application cooperativa-web -n argocd --watch`. Después compruebe el texto actualizado en la página. El commit `9a5b583` se publicó específicamente para esta prueba.

## Informe y capturas

El [informe individual](informe/INFORME.md) contiene capturas reales de GitHub, Argo CD y la página web, además de imágenes generadas a partir de salidas reales de `kubectl` con los archivos de texto originales. Incluye la prueba del HPA al subir de 2 a 3 réplicas, su retorno a 2 y la sincronización automática del commit `9a5b583`.
