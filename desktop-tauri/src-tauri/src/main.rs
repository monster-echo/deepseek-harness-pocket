// Windows 下发布构建不弹控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dsh_pocket_lib::run()
}
