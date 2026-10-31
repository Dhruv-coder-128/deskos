# DESK OS — Windows GSMTC Real-Time Event Streamer
# Listens to MediaPropertiesChanged, PlaybackInfoChanged, TimelinePropertiesChanged, SessionsChanged
# Emits JSON lines to standard output on every state change.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
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

if (-not $mgr) {
    @{ available = $false; has_session = $false; diagnostic = "GSMTC Manager unavailable" } | ConvertTo-Json -Compress
    exit 1
}

function Emit-MediaState($s) {
    if (-not $s) {
        $out = @{
            type = "media_state"
            has_session = $false
            available = $false
            title = ""
            artist = ""
            album = ""
            playback_status = "Stopped"
            status = "STOPPED"
            position_seconds = 0.0
            duration_seconds = 0.0
            source_app = ""
            artwork_base64 = $null
            artwork_b64 = $null
            can_play_pause = $false
            can_next = $false
            can_prev = $false
            diagnostic = "No active media session"
        }
        $out | ConvertTo-Json -Compress
        [Console]::Out.Flush()
        return
    }

    try {
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
            type = "media_state"
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
            diagnostic = "GSMTC Event: " + $pbStatus
        }
        $res | ConvertTo-Json -Compress
        [Console]::Out.Flush()
    } catch {
        # ignore transient read exceptions
    }
}

# Initial emit
$current = $mgr.GetCurrentSession()
if (-not $current) {
    $all = $mgr.GetSessions()
    if ($all -and $all.Count -gt 0) { $current = $all[0] }
}
Emit-MediaState $current

# Polling and event loop (500ms heartbeat check for timeline/session changes)
$lastTitle = if ($current) { $current.SourceAppUserModelId } else { "" }
$lastStatus = ""
$lastPos = -1

while ($true) {
    Start-Sleep -Milliseconds 500
    $s = $mgr.GetCurrentSession()
    if (-not $s) {
        $all = $mgr.GetSessions()
        if ($all -and $all.Count -gt 0) { $s = $all[0] }
    }

    if (-not $s) {
        if ($current -ne $null) {
            $current = $null
            Emit-MediaState $null
        }
        continue
    }

    $current = $s
    $info = $s.GetPlaybackInfo()
    $status = if ($info) { $info.PlaybackStatus.ToString() } else { "Unknown" }
    $tl = $s.GetTimelineProperties()
    $pos = if ($tl -and $tl.Position) { [math]::Round([double]$tl.Position.TotalSeconds, 1) } else { 0 }

    # Detect state change or timeline tick
    if ($status -ne $lastStatus -or [math]::Abs($pos - $lastPos) -ge 1.0) {
        $lastStatus = $status
        $lastPos = $pos
        Emit-MediaState $s
    }
}

