use lazy_static::lazy_static;
use parking_lot::Mutex;
use std::panic;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use sysinfo::{Pid as SysPid, System};
use process_memory::{ProcessHandle, Pid as ProcPid, TryIntoProcessHandle};

#[derive(Clone)]
struct ProcessInfo {
    handle: Option<ProcessHandle>,
    previous_pid: Option<SysPid>,
    current_dir: Option<String>,
}

// ProcessHandle isn't Send/Sync by default, so we need to implement it
// This is safe because we're only using the handle for memory operations
unsafe impl Send for ProcessInfo {}
unsafe impl Sync for ProcessInfo {}

struct ProcessScanner {
    process_info: Arc<Mutex<ProcessInfo>>,
    is_scanning: Arc<AtomicBool>,
}

impl ProcessScanner {
    fn new() -> Self {
        ProcessScanner {
            process_info: Arc::new(Mutex::new(ProcessInfo { 
                handle: None,
                previous_pid: None,
                current_dir: None,
            })),
            is_scanning: Arc::new(AtomicBool::new(false)),
        }
    }

    fn start_scanning(&mut self, names: Vec<String>) {
        let is_scanning = self.is_scanning.clone();
        let process_info = self.process_info.clone();
        is_scanning.store(true, Ordering::SeqCst);

        thread::spawn(move || {
            while is_scanning.load(Ordering::SeqCst) {
                let scan_result = panic::catch_unwind(|| {
                    let mut local_system = System::new_all();
                    local_system.refresh_processes();

                    local_system
                        .processes()
                        .iter()
                        .find_map(|(&pid, process)| {
                            let process_name = process.name().to_lowercase();
                            let process_status = process.status();
                            let process_memory = process.memory();

                            if names.iter().any(|name| {
                                name.to_lowercase() == process_name
                                    && process_status == sysinfo::ProcessStatus::Run
                                    && process_memory > 1024768
                            }) {
                                let cwd = process.cwd()
                                    .map_or_else(
                                        || String::from("<unknown>"),
                                        |path| path.to_string_lossy().into_owned()
                                    );
                                Some((pid, cwd))
                            } else {
                                None
                            }
                        })
                });

                let mut info = process_info.lock();
                let found_process = match scan_result {
                    Ok(Some((pid, cwd))) => {
                        if info.previous_pid != Some(pid) {
                            println!("Found process PID: {} with path {}", pid, cwd);
                            info.previous_pid = Some(pid);
                            info.current_dir = Some(cwd);
                        }
                        Some(pid)
                    }
                    Ok(None) => None,
                    Err(err) => {
                        eprintln!("Process scanning panicked: {:?}", err);
                        None
                    }
                };

                if found_process.is_none() && info.previous_pid.is_some() {
                    println!("Game disconnected");
                    info.previous_pid = None;
                    info.current_dir = None;
                }

                match found_process {
                    Some(pid) => {
                        if info.handle.is_none() || info.previous_pid != Some(pid) {
                            let proc_pid: ProcPid = pid.as_u32().into();
                            info.handle = proc_pid.try_into_process_handle().ok();
                        }
                    }
                    None => info.handle = None,
                }

                drop(info);
                thread::sleep(Duration::from_millis(200));
            }
        });
    }

    fn get_handle(&self) -> Option<ProcessHandle> {
        self.process_info.lock().handle
    }

    fn invalidate_handle(&self) {
        let mut info = self.process_info.lock();
        info.handle = None;
        info.previous_pid = None;
    }

    fn get_current_dir(&self) -> Option<String> {
        self.process_info.lock().current_dir.clone()
    }
}

lazy_static! {
    static ref SCANNER: Mutex<ProcessScanner> = Mutex::new(ProcessScanner::new());
}

pub fn initialize(names: Vec<String>) {
    SCANNER.lock().start_scanning(names);
}

pub fn get_process_handle() -> Option<ProcessHandle> {
    SCANNER.lock().get_handle()
}

pub fn invalidate_handle() {
    SCANNER.lock().invalidate_handle();
}

pub fn get_current_dir() -> Option<String> {
    SCANNER.lock().get_current_dir()
}

pub fn is_ff7_running() -> bool {
    SCANNER.lock().get_handle().is_some()
}