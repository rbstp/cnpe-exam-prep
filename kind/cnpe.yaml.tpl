kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: __CLUSTER__
networking:
  # __CNI_COMMENT__
  disableDefaultCNI: __DISABLE_CNI__
  kubeProxyMode: "iptables"
  apiServerAddress: "127.0.0.1"
  podSubnet: "10.244.0.0/16"
  serviceSubnet: "10.96.0.0/16"
nodes:
  - role: control-plane
    image: __IMAGE__
    kubeadmConfigPatches:
      - |
        kind: ClusterConfiguration
        # Bind control-plane component metrics to 0.0.0.0. kubeadm defaults them to
        # 127.0.0.1, so Prometheus cannot scrape kube-controller-manager, kube-scheduler
        # or etcd and Grafana's control-plane dashboards stay empty. 6 targets DOWN.
        controllerManager:
          extraArgs:
            bind-address: 0.0.0.0
        scheduler:
          extraArgs:
            bind-address: 0.0.0.0
        etcd:
          local:
            extraArgs:
              listen-metrics-urls: http://0.0.0.0:2381
        apiServer:
          extraArgs:
            audit-policy-file: /etc/kubernetes/audit/policy.yaml
            audit-log-path: /var/log/kubernetes/audit.log
            audit-log-maxage: "2"
            audit-log-maxbackup: "2"
            audit-log-maxsize: "100"
          extraVolumes:
            - name: audit-policy
              hostPath: /etc/kubernetes/audit
              mountPath: /etc/kubernetes/audit
              readOnly: true
              pathType: DirectoryOrCreate
            - name: audit-log
              hostPath: /var/log/kubernetes
              mountPath: /var/log/kubernetes
              readOnly: false
              pathType: DirectoryOrCreate
      - |
        kind: KubeProxyConfiguration
        metricsBindAddress: 0.0.0.0:10249
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true,topology.kubernetes.io/zone=zone-a"
    extraMounts:
      - hostPath: __AUDIT_DIR__
        containerPath: /etc/kubernetes/audit
        readOnly: true
    extraPortMappings:
      - { containerPort: 30080, hostPort: 8080, protocol: TCP }
      - { containerPort: 30443, hostPort: 8443, protocol: TCP }
  - role: worker
    image: __IMAGE__
    kubeadmConfigPatches:
      - |
        kind: JoinConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "topology.kubernetes.io/zone=zone-a,tenant=shared"
  - role: worker
    image: __IMAGE__
    kubeadmConfigPatches:
      - |
        kind: JoinConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "topology.kubernetes.io/zone=zone-b,tenant=shared"
containerdConfigPatches:
  - |-
    [plugins."io.containerd.grpc.v1.cri".registry]
      config_path = "/etc/containerd/certs.d"
