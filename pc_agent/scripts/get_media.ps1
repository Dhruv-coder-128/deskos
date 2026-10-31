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
    # Fallback: if current session is null, find the first available session in GetSessions()
    if (-not $s) {
        $all = $mgr.GetSessions()
        if ($all -and $all.Count -gt 0) {
            # Prefer playing sessions first
            foreach ($cand in $all) {
                $pInfo = $cand.GetPlaybackInfo()
                if ($pInfo -and $pInfo.PlaybackStatus.ToString() -eq "Playing") {
                    $s = $cand
                    break
                }
            }
            if (-not $s) {
                $s = $all[0]
            }
        }
    }

    if ($s) {
        [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media, ContentType = WindowsRuntime] | Out-Null
        $pOp = $s.TryGetMediaPropertiesAsync()
        $props = Await-AsyncOp $pOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $info = $s.GetPlaybackInfo()
        $timeline = $s.GetTimelineProperties()

        $thumbB64 = $null
        if ($props -and $props.Thumbnail) {
            try {
                [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
                $tOp = $props.Thumbnail.OpenReadAsync()
                $stream = Await-AsyncOp $tOp ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
                if ($stream -and $stream.Size -gt 0) {
                    [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
                    $reader = New-Object Windows.Storage.Streams.DataReader($stream)
                    $loadOp = $reader.LoadAsync($stream.Size)
                    $count = Await-AsyncOp $loadOp ([System.UInt32])
                    $bytes = New-Object byte[] $count
                    $reader.ReadBytes($bytes)
                    $thumbB64 = "data:image/jpeg;base64," + [Convert]::ToBase64String($bytes)
                }
            } catch {}
        }

        $canPlayPause = $true
        $canNext = $false
        $canPrev = $false
        if ($info -and $info.Controls) {
            $canPlayPause = [bool]$info.Controls.IsPlayPauseToggleEnabled
            $canNext = [bool]$info.Controls.IsNextEnabled
            $canPrev = [bool]$info.Controls.IsPreviousEnabled
        }

        $pbStatus = if ($info) { $info.PlaybackStatus.ToString() } else { "Unknown" }

        $res = @{
            has_session = $true
            available = $true
            title = if ($props -and $props.Title) { $props.Title } else { "" }
            artist = if ($props -and $props.Artist) { $props.Artist } else { "" }
            album = if ($props -and $props.AlbumTitle) { $props.AlbumTitle } else { "" }
            playback_status = $pbStatus
            status = $pbStatus.ToUpper()
            position_seconds = if ($timeline -and $timeline.Position) { [double]$timeline.Position.TotalSeconds } else { 0.0 }
            duration_seconds = if ($timeline -and $timeline.EndTime) { [double]$timeline.EndTime.TotalSeconds } else { 0.0 }
            source_app = if ($s.SourceAppUserModelId) { $s.SourceAppUserModelId } else { "Media" }
            artwork_b64 = $thumbB64
            artwork_base64 = $thumbB64
            can_play_pause = $canPlayPause
            can_next = $canNext
            can_prev = $canPrev
            diagnostic = "Live GSMTC session active"
        }
        $res | ConvertTo-Json -Compress
        exit 0
    }
}

@{
    has_session = $false
    available = $false
    title = ""
    artist = ""
    album = ""
    playback_status = "Stopped"
    status = "STOPPED"
    position_seconds = 0.0
    duration_seconds = 0.0
    artwork_b64 = $null
    artwork_base64 = $null
    source_app = $null
    can_play_pause = $false
    can_next = $false
    can_prev = $false
    diagnostic = "No active Windows media session detected"
} | ConvertTo-Json -Compress
