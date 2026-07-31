package com.mxsuite.repository;

import com.mxsuite.model.ChatFile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface ChatFileRepository extends JpaRepository<ChatFile, UUID> {
}
