$ports = 5000..5010
foreach ($p in $ports) {
    $pids = (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
    
    # Changed $pid to $pIDItem to avoid the read-only conflict
    foreach ($pIDItem in $pids) { 
        if ($pIDItem) { 
            Stop-Process -Id $pIDItem -Force -ErrorAction SilentlyContinue 
        } 
    }
}