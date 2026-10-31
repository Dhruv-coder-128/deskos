param(
    [string]$Action = "play_pause",
    [double]$PositionSeconds = 0.0
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await-AsyncOp($op, $type) {
    if (-not $op) { return $null }
    $method = $asTaskGeneric.MakeGenericMethod($type)
    $task = $method.Invoke($null, @($op))
    $task.Wait(1200) | Out-Null
    return $task.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
$mOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$mgr = Await-AsyncOp $mOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

if ($mgr) {
    $s = $mgr.GetCurrentSession()
    if (-not $s) {
        $all = $mgr.GetSessions()
        if ($all -and $all.Count -gt 0) {
            $s = $all[0]
        }
    }

    if ($s) {
        $res = $false
        switch ($Action.ToLower()) {
            "play_pause" {
                $op = $s.TryTogglePlayPauseAsync()
                $res = Await-AsyncOp $op ([System.Boolean])
            }
            "play" {
                $op = $s.TryPlayAsync()
                $res = Await-AsyncOp $op ([System.Boolean])
            }
            "pause" {
                $op = $s.TryPauseAsync()
                $res = Await-AsyncOp $op ([System.Boolean])
            }
            "next" {
                $op = $s.TrySkipNextAsync()
                $res = Await-AsyncOp $op ([System.Boolean])
            }
            "previous" {
                $op = $s.TrySkipPreviousAsync()
                $res = Await-AsyncOp $op ([System.Boolean])
            }
            "stop" {
                $op = $s.TryStopAsync()
                $res = Await-AsyncOp $op ([System.Boolean])
            }
            "seek" {
                $ticks = [long]($PositionSeconds * 10000000)
                $timeSpan = New-Object System.TimeSpan($ticks)
                $op = $s.TryChangePlaybackPositionAsync($timeSpan.Ticks)
                $res = Await-AsyncOp $op ([System.Boolean])
            }
        }

        @{
            success = [bool]$res
            action = $Action
            session = $s.SourceAppUserModelId
            method = "GSMTC"
        } | ConvertTo-Json -Compress
        exit 0
    }
}

@{
    success = $false
    action = $Action
    error = "No active GSMTC session"
    method = "none"
} | ConvertTo-Json -Compress

