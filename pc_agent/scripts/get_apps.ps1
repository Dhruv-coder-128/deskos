$apps = Get-StartApps | Where-Object {
    $_.Name -and 
    $_.Name -notmatch "Uninstall|Uninstaller|Help|Documentation|Readme|Release Notes|Visit |Website|Welcome" -and
    $_.AppID -notmatch "\.chm$|\.url$|\.txt$|\.htm$|\.html$|unins\d*\.exe$|^https?://"
}

$result = @()
$seen = @{}

foreach ($app in $apps) {
    if ($seen.ContainsKey($app.Name)) { continue }
    $seen[$app.Name] = $true

    $n = $app.Name.ToLower()

    $cat = "general"
    if ($n -match "calculator|notepad|clock|paint|snipping|task manager|7-zip|winrar|alarm|character map") {
        $cat = "utility"
    } elseif ($n -match "chrome|edge|brave|firefox|opera|browser|vivaldi|tor") {
        $cat = "browser"
    } elseif ($n -match "code|studio|visual studio|python|terminal|powershell|cmd|git|docker|postman|node|intellij|command prompt") {
        $cat = "developer"
    } elseif ($n -match "spotify|music|media|vlc|player|video|sound|netflix|youtube|camera|voice") {
        $cat = "media"
    } elseif ($n -match "control panel|settings|explorer|system|disk cleanup|device") {
        $cat = "system"
    }

    $result += @{
        name = $app.Name
        app_id = $app.AppID
        category = $cat
    }
}

$result | ConvertTo-Json -Compress
