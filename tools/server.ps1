param([int]$Port = 8877)

# tools\ 의 상위 폴더(index.html 있는 곳)를 서빙한다
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)

function Get-MimeType([string]$Path) {
    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { "text/html; charset=utf-8" }
        ".js"   { "text/javascript; charset=utf-8" }
        ".css"  { "text/css; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".svg"  { "image/svg+xml" }
        default { "application/octet-stream" }
    }
}

try {
    $listener.Start()
    Write-Host "Hachibito"
    Write-Host "http://localhost:$Port/"
    Start-Process "http://localhost:$Port/"

    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }

            while (($line = $reader.ReadLine()) -ne "") {
                if ($null -eq $line) { break }
            }

            $parts = $requestLine.Split(' ')
            $method = $parts[0]
            $urlPath = if ($parts.Length -ge 2) { $parts[1] } else { "/" }

            if ($method -ne "GET" -and $method -ne "HEAD") {
                $body = [Text.Encoding]::UTF8.GetBytes("Method Not Allowed")
                $header = "HTTP/1.1 405 Method Not Allowed`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
                $hb = [Text.Encoding]::ASCII.GetBytes($header)
                $stream.Write($hb,0,$hb.Length)
                if ($method -ne "HEAD") { $stream.Write($body,0,$body.Length) }
                continue
            }

            $urlPath = [Uri]::UnescapeDataString($urlPath.Split('?')[0])
            if ($urlPath -eq "/") { $urlPath = "/index.html" }

            $relative = $urlPath.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
            $full = [IO.Path]::GetFullPath((Join-Path $Root $relative))
            $rootFull = [IO.Path]::GetFullPath($Root)

            if (-not $full.StartsWith($rootFull,[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
                $body = [Text.Encoding]::UTF8.GetBytes("Not Found")
                $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
                $hb = [Text.Encoding]::ASCII.GetBytes($header)
                $stream.Write($hb,0,$hb.Length)
                if ($method -ne "HEAD") { $stream.Write($body,0,$body.Length) }
                continue
            }

            $body = [IO.File]::ReadAllBytes($full)
            $mime = Get-MimeType $full
            $header = "HTTP/1.1 200 OK`r`nContent-Type: $mime`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
            $hb = [Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($hb,0,$hb.Length)
            if ($method -ne "HEAD") { $stream.Write($body,0,$body.Length) }
        }
        catch {
            Write-Warning $_
        }
        finally {
            if ($client) { $client.Close() }
        }
    }
}
finally {
    $listener.Stop()
}
